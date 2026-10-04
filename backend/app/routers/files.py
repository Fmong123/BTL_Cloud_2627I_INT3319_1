import logging
import re
import unicodedata
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from ..config import Settings
from ..dependencies import get_settings, get_storage
from ..schemas.file import ErrorResponse, UploadResponse
from ..services.storage import Storage, StorageFailure, StorageUnavailable

router = APIRouter()
logger = logging.getLogger(__name__)
CHUNK_SIZE = 1024 * 1024


def safe_filename(value: str) -> str:
    # Both separators matter: browsers and clients may send Windows filenames.
    basename = value.replace("\\", "/").rsplit("/", 1)[-1]
    normalized = unicodedata.normalize("NFKD", basename).encode("ascii", "ignore").decode()
    safe = re.sub(r"[^a-zA-Z0-9._-]", "_", normalized).strip("._-")
    safe = safe[:120].rstrip(". ") or "file"
    if safe.split(".", 1)[0].upper() in {
        "CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)),
        *(f"LPT{i}" for i in range(1, 10)),
    }:
        safe = f"file-{safe}"
    return safe


@router.post("/upload", status_code=201, response_model=UploadResponse, responses={
    code: {"model": ErrorResponse} for code in (400, 413, 422, 502, 503)
})
def upload_file(
    file: UploadFile = File(...),
    settings: Settings = Depends(get_settings),
    storage: Storage = Depends(get_storage),
) -> UploadResponse:
    # FastAPI executes sync routes in its thread pool. File I/O and future
    # synchronous boto3 calls therefore do not block the async event loop.
    try:
        if not file.filename or not file.filename.strip():
            raise HTTPException(400, "Tệp cần có tên hợp lệ")
        size = 0
        while chunk := file.file.read(CHUNK_SIZE):
            size += len(chunk)
            if size > settings.max_file_size_bytes:
                raise HTTPException(413, f"Tệp vượt quá giới hạn {settings.max_file_size_bytes} byte")
        if size == 0:
            raise HTTPException(400, "Tệp trống — hãy chọn một tệp có nội dung")
        file.file.seek(0)
        file_id = str(uuid4())
        key = f"uploads/dev-user/{file_id}/{safe_filename(file.filename)}"
        content_type = file.content_type or "application/octet-stream"
        try:
            result = storage.upload(file.file, key=key, content_type=content_type)
            if result.key != key or result.storage not in {"local", "s3"}:
                raise StorageFailure("Adapter returned an invalid result")
        except StorageUnavailable:
            raise HTTPException(503, "Dịch vụ lưu trữ chưa được cấu hình hoặc chưa sẵn sàng") from None
        except StorageFailure:
            logger.warning("Storage provider failed to confirm an upload")
            raise HTTPException(502, "Dịch vụ lưu trữ không xác nhận lưu tệp — kiểm tra máy chủ trước khi thử lại") from None
        except Exception:
            # Do not expose SDK messages, credentials, internal paths or names.
            logger.error("Unexpected storage adapter failure")
            raise HTTPException(502, "Không lưu được tệp — kiểm tra dịch vụ lưu trữ") from None
        return UploadResponse(
            id=file_id, key=result.key, storage=result.storage,
            original_name=file.filename, size_bytes=size, content_type=content_type,
        )
    finally:
        file.file.close()

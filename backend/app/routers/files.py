import base64
import binascii
import json
import logging
import re
import unicodedata
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import ValidationError

from ..config import Settings
from ..db import DynamoDBConflict, DynamoDBError, file_key, utc_timestamp
from ..dependencies import (
    get_audit_log, get_dev_owner_id, get_file_metadata, get_settings, get_storage,
)
from ..schemas.file import (
    ErrorResponse, FileListItem, FileListResponse, FileStatusResponse, UploadResponse,
)
from ..services.audit_log import AuditLogRepository
from ..services.file_metadata import FileMetadataRepository
from ..services.storage import Storage, StorageFailure, StorageUnavailable

router = APIRouter()
logger = logging.getLogger(__name__)
CHUNK_SIZE = 1024 * 1024


def require_metadata(settings, metadata, audit=None, *, writing=False):
    if settings.metadata_mode != "dynamodb":
        raise HTTPException(503, "Chức năng metadata chưa được bật")
    if metadata is None or (writing and audit is None):
        raise HTTPException(503, "Dịch vụ metadata chưa sẵn sàng")


def recovery_headers(file_id: str, key: str) -> dict[str, str]:
    return {"X-File-Id": file_id, "X-File-Key": key}


def metadata_failure(exc, *, file_id=None, key=None, stored=False):
    logger.warning("Metadata operation failed (%s), file_id=%s", exc.code, file_id)
    detail = (
        "Nội dung tệp đã được lưu nhưng chưa xác nhận đủ metadata/audit — kiểm tra ID trước khi thử lại"
        if stored else "Không xác nhận được metadata/audit — kiểm tra ID trước khi thử lại"
    )
    return HTTPException(
        503, detail,
        headers=recovery_headers(file_id, key) if file_id is not None and key is not None else None,
    )


def record_upload_failure(metadata, audit, owner_id, file_id, *, unknown, reason, pipeline_enabled=False):
    """Best-effort bookkeeping; preserve the storage error if DB is also unavailable."""
    timestamp = utc_timestamp()
    try:
        metadata.mark_upload_failed(
            owner_id, file_id, outcome_unknown=unknown, updated_at=timestamp,
        )
    except DynamoDBError as exc:
        logger.warning("Could not record failed upload (%s), file_id=%s", exc.code, file_id)
    if pipeline_enabled and not unknown:
        try:
            metadata.mark_pending_scan_failed(owner_id, file_id, reason=reason, updated_at=timestamp)
        except DynamoDBConflict:
            # A scanner has progressed, upload state changed, or the item is missing.
            # Never turn a known result into an upload failure.
            pass
        except DynamoDBError as exc:
            logger.warning("Could not resolve pending scan (%s), file_id=%s", exc.code, file_id)
    try:
        audit.write_event(
            owner_id=owner_id, file_id=file_id, event_id=f"{file_id}:upload_failed",
            occurred_at=timestamp, action="upload_failed", actor="fastapi",
            details={"upload_state": "unknown" if unknown else "failed", "reason": reason},
        )
    except DynamoDBError as exc:
        logger.warning("Could not audit failed upload (%s), file_id=%s", exc.code, file_id)


def scan_summary_aliases(item: dict) -> dict:
    """Read Scan's nested handoff format without returning internal findings.

    Canonical non-empty summary fields win. Zero/[] are also the upload defaults,
    so derive a summary from scan_result when an older Lambda only wrote there.
    Lambda writers should update the canonical top-level summary atomically.
    """
    scan = item.get("scan_result")
    if not isinstance(scan, dict):
        return {}
    need_count = "findings_count" not in item or (
        type(item["findings_count"]) is int and item["findings_count"] == 0
    )
    need_types = "finding_types" not in item or item["finding_types"] == []
    if not need_count and not need_types:
        return {}
    findings = scan.get("findings")
    counts = scan.get("finding_counts")
    summary = {}
    if counts is not None:
        if not isinstance(counts, dict) or any(type(n) is not int or n < 0 for n in counts.values()):
            raise ValueError("Invalid nested finding_counts")
    if findings is not None:
        if not isinstance(findings, list) or any(not isinstance(f, dict) for f in findings):
            raise ValueError("Invalid nested findings")
    if need_count:
        if counts is not None:
            summary["findings_count"] = sum(counts.values())
        elif findings is not None:
            summary["findings_count"] = len(findings)
    if need_types:
        types = [f.get("type") for f in findings] if findings is not None else (
            [name for name, count in counts.items() if count > 0] if counts is not None else None
        )
        if types is not None:
            if any(not isinstance(t, str) or not re.fullmatch(r"[A-Z][A-Z0-9_]{0,63}", t) for t in types):
                raise ValueError("Invalid finding type identifier")
            summary["finding_types"] = list(dict.fromkeys(types))
    return summary


def public_file(item: dict, owner_id: str) -> FileListItem:
    try:
        if item["owner_id"] != owner_id:
            raise ValueError("Unexpected owner")
        return FileListItem(**{
            **item, **scan_summary_aliases(item),
            "id": item["file_id"], "scan_status": item["status"],
            # Transitional alias used by the deployed Scan handoff. Canonical wins.
            "status_reason": item.get("status_reason") or item.get("reason"),
        })
    except (KeyError, ValueError, ValidationError):
        logger.error("Stored metadata does not match the file response schema")
        raise HTTPException(503, "Metadata của tệp chưa đúng cấu trúc ứng dụng") from None


def decode_cursor(cursor: str | None, owner_id: str) -> dict | None:
    if cursor is None:
        return None
    try:
        raw = base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True)
        key = json.loads(raw)
        if not isinstance(key, dict) or set(key) != {"owner_id", "file_id"}:
            raise ValueError("Invalid cursor fields")
        file_key(key["owner_id"], key["file_id"])
        if key["owner_id"] != owner_id:
            raise ValueError("Cursor owner mismatch")
        return key
    except (ValueError, TypeError, binascii.Error, UnicodeDecodeError):
        raise HTTPException(400, "Cursor không hợp lệ cho danh sách hiện tại") from None


def encode_cursor(key: dict | None) -> str | None:
    if key is None:
        return None
    return base64.urlsafe_b64encode(
        json.dumps(key, separators=(",", ":")).encode("utf-8")
    ).decode("ascii").rstrip("=")


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


@router.post("/upload", status_code=201, response_model=UploadResponse, response_model_exclude_none=True, responses={
    code: {"model": ErrorResponse} for code in (400, 413, 422, 502, 503)
})
def upload_file(
    file: UploadFile = File(...),
    settings: Settings = Depends(get_settings),
    storage: Storage = Depends(get_storage),
    metadata: FileMetadataRepository | None = Depends(get_file_metadata),
    audit: AuditLogRepository | None = Depends(get_audit_log),
    owner_id: str = Depends(get_dev_owner_id),
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
        if not storage.configured:
            raise HTTPException(503, "Dịch vụ lưu trữ chưa được cấu hình hoặc chưa sẵn sàng")
        metadata_enabled = settings.metadata_mode == "dynamodb"
        if metadata_enabled:
            require_metadata(settings, metadata, audit, writing=True)
        file_id = str(uuid4())
        key = f"uploads/{owner_id}/{file_id}/{safe_filename(file.filename)}"
        content_type = file.content_type or "application/octet-stream"
        record = None
        if metadata_enabled:
            created = False
            timestamp = utc_timestamp()
            try:
                record = metadata.create_upload_record(
                    owner_id=owner_id, file_id=file_id, original_name=file.filename,
                    key=key, size_bytes=size, content_type=content_type, storage=storage.mode,
                    upload_bucket=settings.s3_bucket_name if storage.mode == "s3" else None,
                    created_at=timestamp,
                    pipeline_enabled=settings.scan_pipeline_enabled,
                )
                created = True
                audit.write_event(
                    owner_id=owner_id, file_id=file_id, event_id=f"{file_id}:upload_started",
                    occurred_at=timestamp, action="upload_started", actor="fastapi",
                    details={"storage": storage.mode, "key": key, "size_bytes": size},
                )
            except DynamoDBError as exc:
                if created:
                    record_upload_failure(
                        metadata, audit, owner_id, file_id,
                        unknown=False, reason="initial_audit_unconfirmed",
                        pipeline_enabled=settings.scan_pipeline_enabled,
                    )
                raise metadata_failure(exc, file_id=file_id, key=key) from None
        try:
            result = storage.upload(file.file, key=key, content_type=content_type)
            if result.key != key or result.storage not in {"local", "s3"} or result.storage != storage.mode:
                raise StorageFailure("Adapter returned an invalid result")
        except StorageUnavailable:
            if metadata_enabled:
                record_upload_failure(metadata, audit, owner_id, file_id, unknown=False, reason="storage_unavailable", pipeline_enabled=settings.scan_pipeline_enabled)
            raise HTTPException(503, "Dịch vụ lưu trữ chưa sẵn sàng", headers=recovery_headers(file_id, key)) from None
        except StorageFailure:
            logger.warning("Storage provider failed to confirm an upload")
            if metadata_enabled:
                record_upload_failure(metadata, audit, owner_id, file_id, unknown=True, reason="storage_unconfirmed", pipeline_enabled=settings.scan_pipeline_enabled)
            raise HTTPException(502, "Dịch vụ lưu trữ không xác nhận lưu tệp — kiểm tra máy chủ trước khi thử lại", headers=recovery_headers(file_id, key)) from None
        except Exception:
            # Do not expose SDK messages, credentials, internal paths or names.
            logger.error("Unexpected storage adapter failure")
            if metadata_enabled:
                record_upload_failure(metadata, audit, owner_id, file_id, unknown=True, reason="storage_unconfirmed", pipeline_enabled=settings.scan_pipeline_enabled)
            raise HTTPException(502, "Không xác nhận được việc lưu tệp — kiểm tra dịch vụ lưu trữ", headers=recovery_headers(file_id, key)) from None
        if metadata_enabled:
            timestamp = utc_timestamp()
            try:
                record = metadata.mark_upload_completed(owner_id, file_id, updated_at=timestamp)
                audit.write_event(
                    owner_id=owner_id, file_id=file_id, event_id=f"{file_id}:upload_completed",
                    occurred_at=timestamp, action="upload_completed", actor="fastapi",
                    details={"storage": result.storage, "key": result.key, "size_bytes": size},
                )
            except DynamoDBError as exc:
                raise metadata_failure(exc, file_id=file_id, key=key, stored=True) from None
            try:
                view = public_file(record, owner_id)
            except HTTPException as exc:
                raise HTTPException(exc.status_code, exc.detail, headers=recovery_headers(file_id, key)) from None
            return UploadResponse(**view.model_dump())
        return UploadResponse(
            id=file_id, key=result.key, storage=result.storage,
            original_name=file.filename, size_bytes=size, content_type=content_type,
        )
    finally:
        file.file.close()


@router.get("/files", response_model=FileListResponse, responses={
    code: {"model": ErrorResponse} for code in (400, 422, 503)
})
def list_files(
    limit: int = Query(20, ge=1, le=100),
    cursor: str | None = Query(None, max_length=2048),
    settings: Settings = Depends(get_settings),
    metadata: FileMetadataRepository | None = Depends(get_file_metadata),
    owner_id: str = Depends(get_dev_owner_id),
) -> FileListResponse:
    require_metadata(settings, metadata)
    start_key = decode_cursor(cursor, owner_id)
    try:
        page = metadata.list_files(owner_id, limit=limit, start_key=start_key)
    except DynamoDBError as exc:
        raise metadata_failure(exc) from None
    return FileListResponse(
        items=[public_file(item, owner_id) for item in page.items],
        next_cursor=encode_cursor(page.next_key),
    )


@router.get("/files/{file_id}/status", response_model=FileStatusResponse, responses={
    code: {"model": ErrorResponse} for code in (400, 404, 503)
})
def get_file_status(
    file_id: str,
    settings: Settings = Depends(get_settings),
    metadata: FileMetadataRepository | None = Depends(get_file_metadata),
    owner_id: str = Depends(get_dev_owner_id),
) -> FileStatusResponse:
    require_metadata(settings, metadata)
    try:
        file_key(owner_id, file_id)
    except ValueError:
        raise HTTPException(400, "ID tệp không hợp lệ") from None
    try:
        item = metadata.get_file(owner_id, file_id)
    except DynamoDBError as exc:
        raise metadata_failure(exc) from None
    if item is None:
        raise HTTPException(404, "Không tìm thấy tệp")
    view = public_file(item, owner_id)
    if view.id != file_id:
        raise HTTPException(503, "Metadata của tệp không khớp ID yêu cầu")
    return FileStatusResponse(
        id=view.id, scan_status=view.scan_status, upload_state=view.upload_state,
        updated_at=view.updated_at, status_reason=view.status_reason,
        findings_count=view.findings_count, finding_types=view.finding_types,
        scanned_at=view.scanned_at, quarantined_at=view.quarantined_at,
    )

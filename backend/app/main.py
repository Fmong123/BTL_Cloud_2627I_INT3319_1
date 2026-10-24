from contextlib import asynccontextmanager
import logging
from typing import TYPE_CHECKING

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .body_limit import UploadBodyLimitMiddleware
from .config import Settings
from .db import DynamoDBError, build_dynamodb_client
from .routers.files import router
from .services.audit_log import AuditLogRepository
from .services.file_metadata import FileMetadataRepository
from .services.s3_service import upload_to_s3
from .services.storage import LocalStorage, Storage, UnconfiguredStorage

if TYPE_CHECKING:
    from .services.s3_storage import S3Uploader

logger = logging.getLogger(__name__)


def build_storage(settings: Settings, *, s3_uploader: "S3Uploader | None" = None) -> Storage:
    """Build server-owned storage; the AWS owner supplies the upload function."""
    if settings.storage_mode == "local":
        return LocalStorage(settings.local_storage_dir)
    if settings.storage_mode != "s3":
        return UnconfiguredStorage()

    # Only S3 mode needs the SDK; importing the uploader has no AWS side effects.
    from .services.s3_storage import S3Storage

    if not callable(s3_uploader):
        logger.warning("S3 uploader is not connected; uploads will return 503")
        return S3Storage(
            bucket=settings.s3_bucket_name, client=None,
            transfer_config=None, uploader=s3_uploader,
        )

    import boto3
    from boto3.s3.transfer import TransferConfig
    from botocore.config import Config
    from botocore.exceptions import BotoCoreError

    transfer_config = TransferConfig(
        multipart_threshold=settings.s3_multipart_threshold_bytes,
        multipart_chunksize=settings.s3_multipart_chunksize_bytes,
        max_concurrency=settings.s3_max_concurrency,
        # Use the classic manager so these concurrency settings are respected.
        preferred_transfer_client="classic",
    )
    try:
        client = boto3.client(
            "s3", region_name=settings.aws_region.strip(),
            config=Config(signature_version="s3v4"),
        )
    except BotoCoreError:
        # Keep SDK/provider details out of the startup log and HTTP response.
        logger.warning("S3 client initialization failed; uploads will return 503")
        client = None

    return S3Storage(
        bucket=settings.s3_bucket_name, client=client,
        transfer_config=transfer_config, uploader=s3_uploader,
    )


def create_app(
    settings: Settings | None = None,
    storage: Storage | None = None,
    *,
    s3_uploader: "S3Uploader | None" = None,
    dynamodb_client=None,
) -> FastAPI:
    settings = settings or Settings.from_env()
    selected_storage = storage if storage is not None else build_storage(
        settings, s3_uploader=s3_uploader,
    )
    if settings.scan_pipeline_enabled and selected_storage.mode != "s3":
        raise ValueError("Scan pipeline requires the S3 storage adapter")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        metadata_client = dynamodb_client
        owns_metadata_client = False
        try:
            if settings.metadata_mode == "dynamodb":
                try:
                    if metadata_client is None:
                        metadata_client = build_dynamodb_client(settings)
                        owns_metadata_client = True
                    app.state.file_metadata = FileMetadataRepository(
                        metadata_client, settings.dynamodb_files_table,
                    )
                    app.state.audit_log = AuditLogRepository(
                        metadata_client, settings.dynamodb_audit_table,
                    )
                except DynamoDBError as exc:
                    logger.warning("DynamoDB initialization failed (%s); metadata requests will return 503", exc.code)
            yield
        finally:
            app.state.file_metadata = None
            app.state.audit_log = None
            try:
                if owns_metadata_client and metadata_client is not None:
                    metadata_client.close()
            finally:
                # Only close clients this factory owns, never injected dependencies.
                if storage is None and selected_storage.mode == "s3":
                    client = getattr(selected_storage, "client", None)
                    if client is not None:
                        client.close()

    app = FastAPI(title="MaySec API", version="0.1.0", lifespan=lifespan, description=(
        "MaySec file upload API. Local storage is an explicit development demo; "
        "DynamoDB metadata optionally enables upload audit, file listing and status. "
        "An explicitly enabled S3 pipeline runs through existing S3/EventBridge triggers; "
        "this API never starts Lambda or Step Functions directly. "
        "Development owner is dev-user; authentication is not integrated."
    ))
    app.state.settings = settings
    app.state.storage = selected_storage
    app.state.file_metadata = None
    app.state.audit_log = None
    app.add_middleware(UploadBodyLimitMiddleware, max_file_size_bytes=settings.max_file_size_bytes)
    # CORS wraps the limiter too, so its 413 response is readable in the UI.
    app.add_middleware(
        CORSMiddleware, allow_origins=list(settings.cors_origins),
        allow_credentials=False, allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type"],
        expose_headers=["X-File-Id", "X-File-Key"],
    )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        detail = (
            "Yêu cầu không hợp lệ — gửi multipart/form-data với trường file chứa một tệp"
            if request.method == "POST" and request.url.path == "/upload"
            else "Tham số yêu cầu không hợp lệ — kiểm tra limit, cursor và đường dẫn"
        )
        return JSONResponse(status_code=422, content={
            "detail": detail
        })

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request, exc):
        return JSONResponse(status_code=exc.status_code, content={"detail": str(exc.detail)}, headers=exc.headers)

    @app.get("/health", tags=["Health"])
    def health():
        return {
            "status": "ok", "storage": app.state.storage.mode,
            "storage_configured": app.state.storage.configured,
            "max_file_size_bytes": settings.max_file_size_bytes,
            "scan_status": "scanning" if settings.scan_pipeline_enabled else "not_started",
            "scan_pipeline_enabled": settings.scan_pipeline_enabled,
            "metadata_mode": settings.metadata_mode,
            "metadata_configured": (
                app.state.file_metadata is not None and app.state.audit_log is not None
            ),
            "owner_mode": "development",
        }

    app.include_router(router, tags=["Files"])
    return app

app = create_app(s3_uploader=upload_to_s3)

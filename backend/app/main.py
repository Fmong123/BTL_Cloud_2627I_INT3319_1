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
from .routers.files import router
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

    # Local/unconfigured startup never imports the AWS SDK or Sang's service.
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
) -> FastAPI:
    settings = settings or Settings.from_env()
    selected_storage = storage if storage is not None else build_storage(
        settings, s3_uploader=s3_uploader,
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:
            yield
        finally:
            # Only close a client this factory owns, never an injected storage.
            if storage is None and selected_storage.mode == "s3":
                client = getattr(selected_storage, "client", None)
                if client is not None:
                    client.close()

    app = FastAPI(title="MaySec API", version="0.1.0", lifespan=lifespan, description=(
        "MaySec file upload API. Local storage is an explicit development demo; "
        "S3 requires a configured uploader. Authentication, scanning and file listing "
        "are not integrated."
    ))
    app.state.settings = settings
    app.state.storage = selected_storage
    app.add_middleware(UploadBodyLimitMiddleware, max_file_size_bytes=settings.max_file_size_bytes)
    # CORS wraps the limiter too, so its 413 response is readable in the UI.
    app.add_middleware(
        CORSMiddleware, allow_origins=list(settings.cors_origins),
        allow_credentials=False, allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type"],
    )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return JSONResponse(status_code=422, content={
            "detail": "Yêu cầu không hợp lệ — gửi multipart/form-data với trường file chứa một tệp"
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
            "scan_status": "not_started",
        }

    app.include_router(router, tags=["Files"])
    return app


app = create_app()

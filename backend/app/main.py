from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .body_limit import UploadBodyLimitMiddleware
from .config import Settings
from .routers.files import router
from .services.storage import LocalStorage, Storage, UnconfiguredStorage


def create_app(settings: Settings | None = None, storage: Storage | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    app = FastAPI(title="MaySec API", version="0.1.0", description=(
        "MaySec file upload API. Local storage is an explicit development demo; "
        "AWS adapter, authentication, scanning and file listing are not integrated."
    ))
    app.state.settings = settings
    app.state.storage = storage if storage is not None else (
        LocalStorage(settings.local_storage_dir) if settings.storage_mode == "local"
        else UnconfiguredStorage()
    )
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

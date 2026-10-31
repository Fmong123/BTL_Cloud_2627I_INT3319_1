from fastapi import Request

from .config import Settings
from .services.audit_log import AuditLogRepository
from .services.file_metadata import FileMetadataRepository
from .services.storage import Storage


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_storage(request: Request) -> Storage:
    # Replace the configured adapter or use dependency_overrides in tests.
    return request.app.state.storage


def get_file_metadata(request: Request) -> FileMetadataRepository | None:
    return request.app.state.file_metadata


def get_audit_log(request: Request) -> AuditLogRepository | None:
    return request.app.state.audit_log


def get_rescanner(request: Request):
    return request.app.state.rescanner


def get_dev_owner_id() -> str:
    """Development only. Replace with verified application identity before shared use."""
    return "dev-user"

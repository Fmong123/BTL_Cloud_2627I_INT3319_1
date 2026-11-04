from fastapi import Depends, Request

from .auth import get_current_user
from .config import Settings
from .services.cognito_auth import AuthUser
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


def get_current_owner_id(user: AuthUser = Depends(get_current_user)) -> str:
    """Use only verified identity; request parameters never select the owner."""
    return user.owner_id

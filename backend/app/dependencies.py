from fastapi import Request

from .config import Settings
from .services.storage import Storage


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_storage(request: Request) -> Storage:
    # Replace the configured adapter or use dependency_overrides in tests.
    return request.app.state.storage

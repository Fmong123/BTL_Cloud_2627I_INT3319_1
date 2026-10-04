from typing import Literal

from pydantic import BaseModel


class ErrorResponse(BaseModel):
    detail: str


class UploadResponse(BaseModel):
    id: str
    key: str
    storage: Literal["local", "s3"]
    original_name: str
    size_bytes: int
    content_type: str
    scan_status: Literal["not_started"] = "not_started"

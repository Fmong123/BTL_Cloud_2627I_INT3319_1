from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictStr, field_validator

from ..db import utc_timestamp

ScanStatus = Literal[
    "not_started", "scanning", "safe", "flagged", "quarantined",
    "quarantine_delete_failed", "unscanned", "error",
]
UploadState = Literal["uploading", "uploaded", "failed", "unknown"]


class ErrorResponse(BaseModel):
    detail: str


class UploadResponse(BaseModel):
    id: str
    key: str
    storage: Literal["local", "s3"]
    original_name: str
    size_bytes: int
    content_type: str
    scan_status: ScanStatus = "not_started"
    upload_state: UploadState | None = None
    created_at: str | None = None


class ScanSummary(BaseModel):
    findings_count: int = Field(default=0, ge=0, strict=True)
    finding_types: list[StrictStr] = Field(default_factory=list)
    status_reason: str | None = None
    scanned_at: str | None = None
    quarantined_at: str | None = None

    @field_validator("scanned_at", "quarantined_at")
    @classmethod
    def normalize_result_timestamp(cls, value: str | None) -> str | None:
        return utc_timestamp(value) if value is not None else None


class FileListItem(UploadResponse, ScanSummary):
    owner_id: str
    upload_state: UploadState = Field(...)
    created_at: str = Field(...)
    updated_at: str
    starred: StrictBool = False
    starred_updated_at: str | None = None

    @field_validator("starred_updated_at")
    @classmethod
    def normalize_star_timestamp(cls, value: str | None) -> str | None:
        return utc_timestamp(value) if value is not None else None


class FilePreferencesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    starred: StrictBool


class FilePreferencesResponse(BaseModel):
    id: str
    starred: StrictBool
    starred_updated_at: str

    @field_validator("starred_updated_at")
    @classmethod
    def normalize_timestamp(cls, value: str) -> str:
        return utc_timestamp(value)


class FileListResponse(BaseModel):
    items: list[FileListItem]
    next_cursor: str | None = None


class FileStatusResponse(ScanSummary):
    id: str
    scan_status: ScanStatus
    upload_state: UploadState
    updated_at: str

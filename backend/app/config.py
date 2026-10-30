"""Server-only configuration; no AWS credentials are required to start."""

from dataclasses import dataclass
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
MIB = 1024 * 1024
MB = 1_000_000
MAX_UPLOAD_BYTES = 100 * MB


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name, str(default)).strip().lower()
    if value not in {"true", "false", "1", "0"}:
        raise ValueError(f"{name} must be true, false, 1 or 0")
    return value in {"true", "1"}


@dataclass(frozen=True)
class Settings:
    storage_mode: str = "unconfigured"
    max_file_size_bytes: int = MAX_UPLOAD_BYTES
    local_storage_dir: Path = BACKEND_DIR / "data"
    cors_origins: tuple[str, ...] = (
        "http://localhost:5173", "http://127.0.0.1:5173",
    )
    s3_bucket_name: str = ""
    aws_region: str = ""
    s3_multipart_threshold_bytes: int = 16 * MIB
    s3_multipart_chunksize_bytes: int = 8 * MIB
    s3_max_concurrency: int = 2
    metadata_mode: str = "disabled"
    scan_pipeline_enabled: bool = False
    dynamodb_region: str = "ap-southeast-2"
    dynamodb_files_table: str = "securedrive-files"
    dynamodb_audit_table: str = "securedrive-audit-log"
    dynamodb_users_table: str = "securedrive-users"

    def __post_init__(self) -> None:
        if type(self.scan_pipeline_enabled) is not bool:
            raise ValueError("MAYSEC_SCAN_PIPELINE_ENABLED must be a boolean")
        if self.scan_pipeline_enabled and (
            self.storage_mode != "s3" or self.metadata_mode != "dynamodb"
        ):
            raise ValueError("Scan pipeline requires S3 storage and DynamoDB metadata")
        if self.metadata_mode not in {"disabled", "dynamodb"}:
            raise ValueError("MAYSEC_METADATA_MODE must be disabled or dynamodb")
        if self.metadata_mode == "dynamodb":
            if self.dynamodb_region != "ap-southeast-2":
                raise ValueError("DynamoDB must use ap-southeast-2")
            for name in (
                self.dynamodb_files_table,
                self.dynamodb_audit_table,
                self.dynamodb_users_table,
            ):
                if not name.startswith("securedrive-"):
                    raise ValueError("DynamoDB table names must start with securedrive-")
        if self.storage_mode not in {"unconfigured", "local", "s3"}:
            raise ValueError("MAYSEC_STORAGE_MODE must be unconfigured, local or s3")
        if type(self.max_file_size_bytes) is not int or self.max_file_size_bytes <= 0:
            raise ValueError("MAYSEC_MAX_FILE_SIZE_BYTES must be positive")
        if self.max_file_size_bytes > MAX_UPLOAD_BYTES:
            object.__setattr__(self, "max_file_size_bytes", MAX_UPLOAD_BYTES)
        if self.s3_multipart_threshold_bytes <= 0:
            raise ValueError("MAYSEC_S3_MULTIPART_THRESHOLD_BYTES must be positive")
        if not 5 * MIB <= self.s3_multipart_chunksize_bytes <= 5 * 1024 * MIB:
            raise ValueError("MAYSEC_S3_MULTIPART_CHUNKSIZE_BYTES must be between 5 MiB and 5 GiB")
        if self.s3_max_concurrency <= 0:
            raise ValueError("MAYSEC_S3_MAX_CONCURRENCY must be positive")
        if self.storage_mode == "s3":
            if not self.s3_bucket_name.strip():
                raise ValueError("S3_BUCKET_NAME is required when storage mode is s3")
            if not self.aws_region.strip():
                raise ValueError("AWS_REGION is required when storage mode is s3")

    @classmethod
    def from_env(cls) -> "Settings":
        directory = Path(os.getenv("MAYSEC_LOCAL_STORAGE_DIR", "data"))
        if not directory.is_absolute():
            directory = BACKEND_DIR / directory
        return cls(
            storage_mode=os.getenv("MAYSEC_STORAGE_MODE", "unconfigured").strip().lower(),
            max_file_size_bytes=int(os.getenv("MAYSEC_MAX_FILE_SIZE_BYTES", str(MAX_UPLOAD_BYTES))),
            local_storage_dir=directory.resolve(),
            cors_origins=tuple(origin.strip() for origin in os.getenv(
                "MAYSEC_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
            ).split(",") if origin.strip()),
            s3_bucket_name=os.getenv("S3_BUCKET_NAME", "").strip(),
            aws_region=os.getenv("AWS_REGION", "").strip(),
            s3_multipart_threshold_bytes=int(os.getenv(
                "MAYSEC_S3_MULTIPART_THRESHOLD_BYTES", str(16 * MIB)
            )),
            s3_multipart_chunksize_bytes=int(os.getenv(
                "MAYSEC_S3_MULTIPART_CHUNKSIZE_BYTES", str(8 * MIB)
            )),
            s3_max_concurrency=int(os.getenv("MAYSEC_S3_MAX_CONCURRENCY", "2")),
            metadata_mode=os.getenv("MAYSEC_METADATA_MODE", "disabled").strip().lower(),
            scan_pipeline_enabled=env_bool("MAYSEC_SCAN_PIPELINE_ENABLED"),
            dynamodb_region=os.getenv("DYNAMODB_REGION", "ap-southeast-2").strip(),
            dynamodb_files_table=os.getenv(
                "DYNAMODB_FILES_TABLE", "securedrive-files"
            ).strip(),
            dynamodb_audit_table=os.getenv(
                "DYNAMODB_AUDIT_TABLE", "securedrive-audit-log"
            ).strip(),
            dynamodb_users_table=os.getenv(
                "DYNAMODB_USERS_TABLE", "securedrive-users"
            ).strip(),
        )

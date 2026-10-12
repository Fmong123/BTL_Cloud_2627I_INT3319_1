"""Server-only configuration; no AWS credentials are required to start."""

from dataclasses import dataclass
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
MIB = 1024 * 1024


@dataclass(frozen=True)
class Settings:
    storage_mode: str = "unconfigured"
    max_file_size_bytes: int = 100 * MIB
    local_storage_dir: Path = BACKEND_DIR / "data"
    cors_origins: tuple[str, ...] = (
        "http://localhost:5173", "http://127.0.0.1:5173",
    )
    s3_bucket_name: str = ""
    aws_region: str = ""
    s3_multipart_threshold_bytes: int = 16 * MIB
    s3_multipart_chunksize_bytes: int = 8 * MIB
    s3_max_concurrency: int = 2

    def __post_init__(self) -> None:
        if self.storage_mode not in {"unconfigured", "local", "s3"}:
            raise ValueError("MAYSEC_STORAGE_MODE must be unconfigured, local or s3")
        if self.max_file_size_bytes <= 0:
            raise ValueError("MAYSEC_MAX_FILE_SIZE_BYTES must be positive")
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
            max_file_size_bytes=int(os.getenv("MAYSEC_MAX_FILE_SIZE_BYTES", str(100 * MIB))),
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
        )

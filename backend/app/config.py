"""Server-only configuration; no AWS credentials are required to start."""

from dataclasses import dataclass
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Settings:
    storage_mode: str = "unconfigured"
    max_file_size_bytes: int = 100 * 1024 * 1024
    local_storage_dir: Path = BACKEND_DIR / "data"
    cors_origins: tuple[str, ...] = (
        "http://localhost:5173", "http://127.0.0.1:5173",
    )

    def __post_init__(self) -> None:
        if self.storage_mode not in {"unconfigured", "local"}:
            raise ValueError("MAYSEC_STORAGE_MODE must be unconfigured or local")
        if self.max_file_size_bytes <= 0:
            raise ValueError("MAYSEC_MAX_FILE_SIZE_BYTES must be positive")

    @classmethod
    def from_env(cls) -> "Settings":
        directory = Path(os.getenv("MAYSEC_LOCAL_STORAGE_DIR", "data"))
        if not directory.is_absolute():
            directory = BACKEND_DIR / directory
        return cls(
            storage_mode=os.getenv("MAYSEC_STORAGE_MODE", "unconfigured").strip().lower(),
            max_file_size_bytes=int(os.getenv("MAYSEC_MAX_FILE_SIZE_BYTES", str(100 * 1024 * 1024))),
            local_storage_dir=directory.resolve(),
            cors_origins=tuple(origin.strip() for origin in os.getenv(
                "MAYSEC_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
            ).split(",") if origin.strip()),
        )

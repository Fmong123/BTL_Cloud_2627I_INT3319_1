"""Boundary handed to AWS-B: synchronous upload, success only after storage confirms."""

from dataclasses import dataclass
import os
from pathlib import Path
import shutil
from typing import BinaryIO, Literal, Protocol
from uuid import uuid4


class StorageUnavailable(Exception):
    """Adapter cannot accept uploads (configuration or provider unavailable)."""


class StorageFailure(Exception):
    """Provider failed to confirm a write."""


class StorageNotFound(Exception):
    """The server-owned object no longer exists."""


class StorageTooLarge(Exception):
    """The object exceeds the bounded read allowance."""


def read_bounded(body: BinaryIO, max_bytes: int) -> bytes:
    """Read no more than the limit plus one sentinel byte; caller owns closing."""
    chunks = []
    total = 0
    while True:
        chunk = body.read(min(1024 * 1024, max_bytes + 1 - total))
        if not chunk:
            return b"".join(chunks)
        if not isinstance(chunk, bytes):
            raise StorageFailure("Storage returned invalid bytes")
        total += len(chunk)
        if total > max_bytes:
            raise StorageTooLarge()
        chunks.append(chunk)


@dataclass(frozen=True)
class StoredObject:
    key: str
    storage: Literal["local", "s3"]


class Storage(Protocol):
    mode: str
    configured: bool

    def upload(self, file_obj: BinaryIO, *, key: str, content_type: str) -> StoredObject:
        """Read from position zero. Preserve key. Return only after successful write.

        AWS-B can implement this interface around upload_to_s3. Configuration
        remains server-side; translate SDK errors to StorageFailure/Unavailable.
        The API owns the file handle and closes it when the request completes.
        """
        ...


class UnconfiguredStorage:
    mode = "unconfigured"
    configured = False

    def upload(self, file_obj: BinaryIO, *, key: str, content_type: str) -> StoredObject:
        raise StorageUnavailable("Dịch vụ lưu trữ chưa được cấu hình")


class LocalStorage:
    """Explicit development adapter: real disk bytes, no AWS or scan simulation."""

    mode = "local"
    configured = True
    content_readable = True

    def __init__(self, directory: Path):
        self.directory = directory.resolve()

    def read(self, *, key: str, max_bytes: int) -> bytes:
        try:
            target = (self.directory / key).resolve()
            if not target.is_relative_to(self.directory) or target == self.directory:
                raise StorageFailure("Invalid storage key")
            with target.open("rb") as source:
                if os.fstat(source.fileno()).st_size > max_bytes:
                    raise StorageTooLarge()
                return read_bounded(source, max_bytes)
        except FileNotFoundError:
            raise StorageNotFound() from None
        except OSError:
            raise StorageFailure("Local read failed") from None

    def upload(self, file_obj: BinaryIO, *, key: str, content_type: str) -> StoredObject:
        target = (self.directory / key).resolve()
        if not target.is_relative_to(self.directory) or target == self.directory:
            raise StorageFailure("Invalid storage key")
        partial = target.with_name(f".{uuid4().hex}.part")
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            with partial.open("xb") as destination:
                shutil.copyfileobj(file_obj, destination, length=1024 * 1024)
                destination.flush()
                os.fsync(destination.fileno())
            os.replace(partial, target)
        except OSError as exc:
            raise StorageFailure("Local write failed") from exc
        finally:
            try:
                partial.unlink(missing_ok=True)
            except OSError:
                # Preserve the original failure; do not accidentally turn it
                # into an unhandled internal error if cleanup is denied.
                pass
        return StoredObject(key=key, storage="local")

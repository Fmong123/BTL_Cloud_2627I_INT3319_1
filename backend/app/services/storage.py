"""Boundary handed to AWS-B: synchronous upload, success only after storage confirms."""

from dataclasses import dataclass
from contextlib import contextmanager
import os
from pathlib import Path
import shutil
import sqlite3
from typing import BinaryIO, Literal, Protocol
from uuid import uuid4
from .quota import FREE_STORAGE_BYTES, QuotaExceeded, quota_view


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

    @contextmanager
    def quota_lock(self):
        try:
            self.directory.mkdir(parents=True, exist_ok=True)
            connection = sqlite3.connect(self.directory / ".maysec-quota.sqlite3", timeout=5)
        except (OSError, sqlite3.Error):
            raise StorageUnavailable("Local quota is unavailable") from None
        try:
            # A filesystem-backed SQLite lock coordinates all local API workers.
            connection.execute("BEGIN IMMEDIATE")
            yield
        except sqlite3.Error:
            raise StorageUnavailable("Local quota is busy") from None
        finally:
            connection.close()

    def storage_usage(self, owner_id):
        if not owner_id or owner_id in {".", ".."} or any(c in owner_id for c in "/\\"):
            raise StorageFailure("Invalid owner")
        with self.quota_lock():
            return quota_view(self._used_bytes(owner_id))

    def _used_bytes(self, owner_id):
        root = self.directory / "uploads" / owner_id
        return sum(path.stat().st_size for path in root.rglob("*") if path.is_file())

    def delete_file(self, *, prefix):
        parts = prefix.rstrip("/").split("/")
        if (len(parts) != 3 or parts[0] != "uploads"
                or any(not p or p in {".", ".."} or "\\" in p for p in parts)):
            raise StorageFailure("Invalid deletion prefix")
        target = self.directory.joinpath(*parts)
        try:
            with self.quota_lock():
                if target.is_symlink() or not target.resolve().is_relative_to(self.directory):
                    raise StorageFailure("Invalid deletion location")
                # Resolve every candidate before deleting any content.
                paths = list(target.rglob("*")) if target.exists() else []
                if any(p.is_symlink() or not p.resolve().is_relative_to(target.resolve()) for p in paths):
                    raise StorageFailure("Invalid deletion location")
                for path in paths:
                    if path.is_file():
                        path.unlink(missing_ok=True)
                for path in sorted((p for p in paths if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
                    path.rmdir()
                if target.exists():
                    target.rmdir()
        except OSError:
            raise StorageFailure("Local deletion failed") from None

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
        parts = key.split("/")
        if len(parts) != 4 or parts[0] != "uploads" or any(not p or p in {".", ".."} or "\\" in p for p in parts):
            raise StorageFailure("Invalid storage key")
        with self.quota_lock():
            size = file_obj.seek(0, 2)
            file_obj.seek(0)
            if self._used_bytes(parts[1]) + size > FREE_STORAGE_BYTES:
                raise QuotaExceeded()
            return self._upload(file_obj, key=key, content_type=content_type)

    def _upload(self, file_obj: BinaryIO, *, key: str, content_type: str) -> StoredObject:
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

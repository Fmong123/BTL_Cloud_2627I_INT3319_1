"""API adapter for the synchronous S3 uploader supplied by the AWS owner."""

from typing import Any, BinaryIO, Protocol

from botocore.exceptions import (
    BotoCoreError,
    ClientError,
    NoCredentialsError,
    NoRegionError,
    PartialCredentialsError,
)

from .storage import StorageFailure, StorageUnavailable, StoredObject


class S3Uploader(Protocol):
    """Return the unchanged key after S3 confirms the write; raise on failure."""

    def __call__(
        self,
        file_obj: BinaryIO,
        *,
        key: str,
        content_type: str,
        client: Any,
        bucket: str,
        transfer_config: Any,
    ) -> str:
        ...


class S3Storage:
    """Use injected dependencies, without creating an AWS client at import time.

    The application factory supplies Sang's uploader, client and TransferConfig.
    The route owns validation, rewinding and closing the uploaded file.
    """

    mode = "s3"

    def __init__(
        self,
        *,
        bucket: str,
        client: Any,
        transfer_config: Any,
        uploader: S3Uploader | None = None,
    ) -> None:
        self.bucket = bucket.strip()
        self.client = client
        self.transfer_config = transfer_config
        self.uploader = uploader

    @property
    def configured(self) -> bool:
        # Dependency readiness only, not a network/IAM or successful-write check.
        return (
            bool(self.bucket)
            and self.client is not None
            and self.transfer_config is not None
            and callable(self.uploader)
        )

    def upload(self, file_obj: BinaryIO, *, key: str, content_type: str) -> StoredObject:
        uploader = self.uploader
        if not self.configured or uploader is None:
            raise StorageUnavailable("S3 upload dependencies are not configured")

        try:
            stored_key = uploader(
                file_obj,
                key=key,
                content_type=content_type,
                client=self.client,
                bucket=self.bucket,
                transfer_config=self.transfer_config,
            )
        except (NoCredentialsError, PartialCredentialsError, NoRegionError) as exc:
            raise StorageUnavailable("AWS configuration is unavailable") from exc
        except (StorageUnavailable, StorageFailure):
            raise
        except (ClientError, BotoCoreError, OSError) as exc:
            # Keep provider details out of the public error message.
            raise StorageFailure("S3 did not confirm the upload") from exc

        if not isinstance(stored_key, str) or stored_key != key:
            raise StorageFailure("S3 uploader returned an invalid confirmation")

        return StoredObject(key=stored_key, storage="s3")

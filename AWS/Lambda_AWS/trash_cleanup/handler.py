"""Scheduled erasure of expired trash. Package with the selected backend modules."""
import logging
import os

import boto3

from app.config import Settings
from app.db import call_dynamodb, deserialize_item, utc_timestamp
from app.services.file_metadata import FileMetadataRepository
from app.services.lifecycle import FileLifecycle, LifecycleConflict, expired, state
from app.services.s3_storage import S3Storage

logger = logging.getLogger(__name__)


def lambda_handler(event, context):
    settings = Settings(storage_mode="s3", metadata_mode="dynamodb",
        s3_bucket_name=os.environ["UPLOAD_BUCKET"], aws_region=os.environ["AWS_REGION"],
        quarantine_bucket_name=os.environ["QUARANTINE_BUCKET"],
        dynamodb_files_table=os.environ.get("FILES_TABLE", "securedrive-files"))
    metadata = FileMetadataRepository(boto3.client("dynamodb", region_name=settings.dynamodb_region),
                                      settings.dynamodb_files_table)
    storage = S3Storage(bucket=settings.s3_bucket_name, client=boto3.client("s3"),
                        transfer_config=None, uploader=None)
    service = FileLifecycle(metadata, storage, settings)
    removed = failed = 0
    cursor = None
    now = utc_timestamp()
    try:
        while True:
            params = {"TableName": metadata.table_name, "Limit": 100,
                "FilterExpression": "#life IN (:trashed, :deleting) AND #expiry <= :now AND #storage = :s3",
                "ExpressionAttributeNames": {"#life": "lifecycle_state", "#expiry": "trash_expires_at", "#storage": "storage"},
                "ExpressionAttributeValues": {":trashed": {"S": "trashed"}, ":deleting": {"S": "deleting"}, ":now": {"S": now}, ":s3": {"S": "s3"}}}
            if cursor:
                params["ExclusiveStartKey"] = cursor
            page = call_dynamodb(metadata.client, "scan", **params)
            for raw in page.get("Items", []):
                row = deserialize_item(raw)
                if row["owner_id"].startswith("!"):
                    continue
                if context and context.get_remaining_time_in_millis() < 15000:
                    return {"deleted": removed, "failed": failed, "remaining": True}
                current = metadata.get_file(row["owner_id"], row["file_id"])
                if not current or state(current) not in {"trashed", "deleting"} or not expired(current, now):
                    continue
                try:
                    service.purge(current)
                    removed += 1
                except LifecycleConflict:
                    pass  # A concurrent restore/delete won; never touch its bytes.
                except Exception:
                    failed += 1
                    logger.error("Trash erasure failed for file_id=%s", row["file_id"])
            cursor = page.get("LastEvaluatedKey")
            if not cursor:
                break
        if failed:
            raise RuntimeError(f"Trash cleanup incomplete: {failed} file(s)")
        return {"deleted": removed, "failed": 0, "remaining": False}
    finally:
        metadata.client.close()
        storage.client.close()

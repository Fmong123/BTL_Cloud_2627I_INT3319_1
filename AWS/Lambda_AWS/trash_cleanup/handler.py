"""Scheduled erasure of expired trash. Package with the selected backend modules."""
import logging
import os

import boto3

from app.config import Settings
from app.db import call_dynamodb, deserialize_item, utc_timestamp
from app.services.audit_log import AuditLogRepository
from app.services.file_metadata import FileMetadataRepository
from app.services.folders import FolderError, Folders
from app.services.lifecycle import FileLifecycle, LifecycleConflict, expired, state
from app.services.s3_storage import S3Storage

logger = logging.getLogger(__name__)


def lambda_handler(event, context):
    settings = Settings(storage_mode="s3", metadata_mode="dynamodb",
        s3_bucket_name=os.environ["UPLOAD_BUCKET"], aws_region=os.environ["AWS_REGION"],
        quarantine_bucket_name=os.environ["QUARANTINE_BUCKET"],
        dynamodb_files_table=os.environ.get("FILES_TABLE", "securedrive-files"),
        dynamodb_audit_table=os.environ.get("AUDIT_TABLE", "securedrive-audit-log"))
    metadata = FileMetadataRepository(boto3.client("dynamodb", region_name=settings.dynamodb_region),
                                      settings.dynamodb_files_table)
    storage = S3Storage(bucket=settings.s3_bucket_name, client=boto3.client("s3"),
                        transfer_config=None, uploader=None)
    service = FileLifecycle(metadata, storage, settings)
    audit = AuditLogRepository(metadata.client, settings.dynamodb_audit_table)
    removed = folders_removed = failed = 0
    cursor = None
    now = utc_timestamp()
    def should_stop():
        return bool(context and context.get_remaining_time_in_millis() < 15000)

    def result(remaining=False):
        if failed:
            raise RuntimeError(f"Trash cleanup incomplete: {failed} file/folder group(s)")
        return {"deleted": removed, "folders_deleted": folders_removed,
                "failed": failed, "remaining": remaining}

    try:
        while True:
            params = {"TableName": metadata.table_name, "Limit": 100,
                "FilterExpression": "#life IN (:trashed, :deleting) AND #expiry <= :now AND (#storage = :s3 OR begins_with(#owner, :folders))",
                "ExpressionAttributeNames": {"#life": "lifecycle_state", "#expiry": "trash_expires_at", "#storage": "storage", "#owner": "owner_id"},
                "ExpressionAttributeValues": {":trashed": {"S": "trashed"}, ":deleting": {"S": "deleting"}, ":now": {"S": now}, ":s3": {"S": "s3"}, ":folders": {"S": "!folders!"}}}
            if cursor:
                params["ExclusiveStartKey"] = cursor
            page = call_dynamodb(metadata.client, "scan", **params)
            for raw in page.get("Items", []):
                row = deserialize_item(raw)
                is_folder = row["owner_id"].startswith("!folders!")
                if row["owner_id"].startswith("!") and not is_folder:
                    continue
                if is_folder and (row["file_id"] == "!revision" or row.get("trash_root_id") != row["file_id"]):
                    continue
                if should_stop():
                    return result(remaining=True)
                try:
                    current = metadata.get_file(row["owner_id"], row["file_id"])
                    if not current or state(current) not in {"trashed", "deleting"} or not expired(current, now):
                        continue
                    if is_folder:
                        owner = row["owner_id"][len("!folders!"):]
                        if not owner or owner.startswith("!"):
                            continue
                        purged = Folders(metadata, owner, audit, actor="lambda:securedrive-trash-cleanup").purge(
                            row["file_id"], storage, settings, expired_at=now, should_stop=should_stop)
                        removed += purged["files_deleted"]
                        folders_removed += purged["folders_deleted"]
                        if purged["remaining"]:
                            return result(remaining=True)
                    elif current.get("storage") == "s3":
                        service.purge(current)
                        removed += 1
                except LifecycleConflict:
                    pass  # A concurrent restore/delete won; never touch its bytes.
                except FolderError as exc:
                    if exc.status_code not in {404, 409}:
                        failed += 1
                        logger.error("Trash erasure failed for file_id=%s", row["file_id"])
                except Exception:
                    failed += 1
                    logger.error("Trash erasure failed for file_id=%s", row["file_id"])
            cursor = page.get("LastEvaluatedKey")
            if not cursor:
                break
        return result()
    finally:
        metadata.client.close()
        storage.client.close()

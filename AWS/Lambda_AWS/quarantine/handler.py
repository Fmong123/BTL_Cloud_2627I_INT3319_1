"""Version-aware quarantine with recoverable copy/delete bookkeeping."""
import os
from functools import lru_cache
import boto3
from botocore.exceptions import BotoCoreError, ClientError
from pipeline_common import (PipelineConflict, put_audit, read_file, source_from_event,
                             status_fields, summary, update_file, utc)

FILES_TABLE = os.environ.get("FILES_TABLE", "securedrive-files")
AUDIT_TABLE = os.environ.get("AUDIT_TABLE", "securedrive-audit-log")
QUARANTINE_BUCKET = os.environ.get("QUARANTINE_BUCKET", "")
KMS_KEY_ID = os.environ.get("KMS_KEY_ID", "")

class QuarantineError(Exception):
    pass

@lru_cache(maxsize=None)
def _client(name):
    return boto3.client(name)

@lru_cache(maxsize=None)
def _table(name):
    return boto3.resource("dynamodb").Table(name)

def head(bucket, key, version=None):
    args = {"Bucket": bucket, "Key": key}
    if version:
        args["VersionId"] = version
    try:
        return _client("s3").head_object(**args)
    except ClientError as exc:
        if exc.response["Error"]["Code"] in {"404", "NoSuchKey", "NoSuchVersion", "NotFound"}:
            return None
        raise

def verify_destination(destination, expected_size):
    if not destination or destination.get("ContentLength") != expected_size:
        raise QuarantineError("quarantine_size_mismatch")
    actual = destination.get("SSEKMSKeyId", "")
    if not KMS_KEY_ID or KMS_KEY_ID.startswith("alias/") or ":alias/" in KMS_KEY_ID:
        raise QuarantineError("kms_key_arn_or_id_required")
    if destination.get("ServerSideEncryption") != "aws:kms" or (
        actual != KMS_KEY_ID and not (not KMS_KEY_ID.startswith("arn:") and actual.rsplit("/", 1)[-1] == KMS_KEY_ID)
    ):
        raise QuarantineError("quarantine_kms_mismatch")
    return actual

def record_failure(source, ctx, reason, *, deletion=False, location=None):
    row = read_file(_table(FILES_TABLE), source)
    if row["status"] == "quarantined":
        return row
    deletion = deletion or row["status"] == "quarantine_delete_failed"
    status = "quarantine_delete_failed" if deletion else "flagged"
    fields = {**status_fields(status, source["file_id"]),
              "quarantine_status": "delete_failed" if deletion else "copy_failed",
              "status_reason": "quarantine_delete_failed" if deletion else reason,
              "quarantine_reason": "quarantine_delete_failed" if deletion else reason}
    fields.update(location or {})
    saved = update_file(_table(FILES_TABLE), source, fields,
                        statuses=["flagged", "quarantine_delete_failed"], execution=ctx.get("execution"))
    put_audit(_table(AUDIT_TABLE), source,
              "quarantine_delete_failed" if deletion else "quarantine_failed", status,
              {"reason": fields["status_reason"]}, utc(ctx.get("entered_at")),
              execution_id=row.get("execution_id"), suffix=ctx.get("execution", "") + "|" + fields["status_reason"])
    return saved

def finish(source, row, location, ctx):
    timestamp = row.get("quarantined_at") or utc()
    fields = {**status_fields("quarantined", source["file_id"], timestamp),
              **location, "quarantined_at": timestamp, "quarantine_status": "completed"}
    remove = ["quarantine_reason"]
    if not row.get("extraction_complete", True) and row.get("scan_reason"):
        fields["status_reason"] = row["scan_reason"]
    else:
        remove.append("status_reason")
    if row["status"] == "quarantined":
        saved = row
    else:
        saved = update_file(_table(FILES_TABLE), source, fields,
                            statuses=["flagged", "quarantine_delete_failed"],
                            remove=remove, execution=ctx.get("execution"))
    put_audit(_table(AUDIT_TABLE), source, "quarantine_completed", "quarantined",
              {**location, **summary(saved)}, timestamp, execution_id=saved.get("execution_id"))
    return {"status": "quarantined", **location, **summary(saved),
            "owner_id": source["owner_id"], "file_id": source["file_id"], "quarantined_at": timestamp}

def lambda_handler(event, context):
    source = source_from_event(event)
    ctx = event.get("ctx") or {}
    row = read_file(_table(FILES_TABLE), source)
    from pipeline_common import verify_rescan_execution
    verify_rescan_execution(row, event)
    if row["status"] not in {"flagged", "quarantine_delete_failed", "quarantined"}:
        raise PipelineConflict("file_not_flagged")
    if event.get("operation") == "record_failure":
        return {"status": record_failure(source, ctx, row.get("quarantine_reason") or "quarantine_failed")["status"]}
    if not source["version"] or not QUARANTINE_BUCKET or not KMS_KEY_ID:
        raise QuarantineError("quarantine_configuration_incomplete")
    if (event.get("scan") or {}).get("status") != "flagged":
        raise PipelineConflict("scan_not_flagged")
    if row["status"] != "quarantined":
        update_file(_table(FILES_TABLE), source, {"quarantine_status": row.get("quarantine_status", "pending")},
                    statuses=[row["status"]], execution=ctx.get("execution"))
    destination_key = f"{source['key']}.version-{source['version']}"
    location = {"quarantine_bucket": QUARANTINE_BUCKET, "quarantine_key": destination_key,
                "source_version_id": source["version"]}
    phase = "copy"
    try:
        if row.get("quarantine_bucket") and row["quarantine_bucket"] != QUARANTINE_BUCKET:
            raise QuarantineError("quarantine_bucket_mismatch")
        source_head = head(source["bucket"], source["key"], source["version"])
        destination = head(QUARANTINE_BUCKET, destination_key, row.get("quarantine_version_id"))
        if not source_head:
            if row.get("quarantine_key") != destination_key:
                raise QuarantineError("source_missing_without_copy_record")
        else:
            if source_head.get("ContentLength") != row["size_bytes"]:
                raise QuarantineError("source_size_mismatch")
            if destination is None:
                copied = _client("s3").copy_object(
                    CopySource={"Bucket": source["bucket"], "Key": source["key"], "VersionId": source["version"]},
                    Bucket=QUARANTINE_BUCKET, Key=destination_key, ServerSideEncryption="aws:kms",
                    SSEKMSKeyId=KMS_KEY_ID, BucketKeyEnabled=True, MetadataDirective="COPY")
                destination = head(QUARANTINE_BUCKET, destination_key, copied.get("VersionId"))
        location["kms_key"] = verify_destination(destination, row["size_bytes"])
        if destination.get("VersionId"):
            location["quarantine_version_id"] = destination["VersionId"]
        if row["status"] == "quarantined":
            if source_head:
                raise QuarantineError("completed_source_still_exists")
            return finish(source, row, location, ctx)
        # Persist copy evidence before deletion so retry can recover after a crash.
        update_file(_table(FILES_TABLE), source, {**location, "quarantine_status": "copied"},
                    statuses=["flagged", "quarantine_delete_failed"], execution=ctx.get("execution"))
        phase = "delete"
        if source_head:
            _client("s3").delete_object(Bucket=source["bucket"], Key=source["key"], VersionId=source["version"])
    except (BotoCoreError, ClientError, QuarantineError) as exc:
        reason = str(exc) if isinstance(exc, QuarantineError) else "quarantine_" + phase + "_failed"
        record_failure(source, ctx, reason, deletion=phase == "delete", location=location if phase == "delete" else None)
        raise QuarantineError(reason) from exc
    return finish(source, row, location, ctx)

"""Per-channel delivery bookkeeping; uncertain sends require reconciliation."""
import json
import os
import uuid
import urllib.error
import urllib.request
from functools import lru_cache
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from pipeline_common import (PipelineConflict, conditional_failure, ids_from_key,
                             put_audit, read_file, summary, update_file, utc)

FILES_TABLE = os.environ.get("FILES_TABLE", "securedrive-files")
AUDIT_TABLE = os.environ.get("AUDIT_TABLE", "securedrive-audit-log")
TOPIC_ARN = os.environ.get("SNS_TOPIC_ARN", "")
WEBHOOK_URL = os.environ.get("WEBHOOK_URL", "")

class NotificationFailed(Exception):
    pass

@lru_cache(maxsize=None)
def _table(name):
    return boto3.resource("dynamodb").Table(name)

@lru_cache(maxsize=None)
def _sns():
    # Do not let SDK retries blindly publish an ambiguous SNS request again.
    return boto3.client("sns", config=Config(retries={"total_max_attempts": 1}))

def notification_source(event):
    owner_id, file_id = ids_from_key(event["key"])
    for name, actual in (("owner_id", owner_id), ("file_id", file_id)):
        if event.get(name, actual) != actual:
            raise PipelineConflict("notification_identity_mismatch")
    row = _table(FILES_TABLE).get_item(Key={"owner_id": owner_id, "file_id": file_id}, ConsistentRead=True).get("Item")
    if not row:
        raise PipelineConflict("missing_file")
    version = event.get("source_version_id") or row.get("source_version_id")
    source = {"owner_id": owner_id, "file_id": file_id, "key": event["key"],
              "bucket": row.get("upload_bucket"), "version": version}
    return source, read_file(_table(FILES_TABLE), source)

def build_message(result, row):
    # Only summary codes/counts enter the notification, never findings/location.
    data = summary(row)
    if result == "quarantined":
        subject = "[MaySec] File quarantined"
        body = f"Tep: {row['original_name']}\nKet qua: DA CACH LY\nSo phat hien: {data['findings_count']}\nLoai: {', '.join(data['finding_types'])}"
    else:
        subject = "[MaySec] File safe"
        body = f"Tep: {row['original_name']}\nKet qua: Khong phat hien theo pham vi kiem tra"
    return subject, body

def send_sns(subject, body):
    if not TOPIC_ARN:
        raise NotificationFailed("sns_topic_not_configured")
    return _sns().publish(TopicArn=TOPIC_ARN, Subject=subject, Message=body)["MessageId"]

def send_webhook(subject, body):
    req = urllib.request.Request(WEBHOOK_URL, data=json.dumps({"text": subject + "\n" + body}).encode("utf-8"),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=5) as response:
        if not 200 <= response.status < 300:
            raise NotificationFailed("webhook_unconfirmed")
        return f"http {response.status}"

def delivery(source, result, channel, sender, subject, body):
    prefix = f"notify_{result}_{channel}"
    row = read_file(_table(FILES_TABLE), source)
    state = row.get(prefix + "_state")
    if state == "sent":
        return row[prefix + "_receipt"]
    if state in {"sending", "unknown"}:
        raise NotificationFailed(channel + "_delivery_requires_reconciliation")
    token, timestamp = str(uuid.uuid4()), utc()
    fields = {prefix + "_state": "sending", prefix + "_token": token, prefix + "_at": timestamp}
    try:
        update_file(_table(FILES_TABLE), source, fields, statuses=[result],
                    extra_condition="(attribute_not_exists(#delivery) OR #delivery = :failed)",
                    extra_names={"#delivery": prefix + "_state"}, extra_values={":failed": "failed"})
    except ClientError as exc:
        if conditional_failure(exc):
            raise NotificationFailed(channel + "_delivery_already_claimed") from exc
        raise
    try:
        receipt = sender(subject, body)
    except Exception as exc:
        # Explicit rejection is retryable. Network/5xx ambiguity is NOT resent automatically.
        code = exc.response.get("Error", {}).get("Code", "") if isinstance(exc, ClientError) else ""
        rejected = code in {"Throttled", "Throttling", "ThrottlingException", "AuthorizationError", "InvalidParameter", "NotFound"}
        rejected = rejected or isinstance(exc, urllib.error.HTTPError) and 400 <= exc.code < 500
        rejected = rejected or isinstance(exc, NotificationFailed) and str(exc) == "sns_topic_not_configured"
        outcome = "failed" if rejected else "unknown"
        update_file(_table(FILES_TABLE), source, {prefix + "_state": outcome}, statuses=[result],
                    extra_condition="#token = :token", extra_names={"#token": prefix + "_token"}, extra_values={":token": token})
        put_audit(_table(AUDIT_TABLE), source, "notify_failed", result,
                  {"channel": channel, "delivery_state": outcome, "reason": type(exc).__name__}, timestamp,
                  execution_id=row.get("execution_id"), suffix=token)
        raise NotificationFailed(channel + "_" + outcome) from None
    # If this DB write fails after sending, 'sending' prevents an automatic duplicate.
    update_file(_table(FILES_TABLE), source, {prefix + "_state": "sent", prefix + "_receipt": receipt,
                                             prefix + "_sent_at": utc()}, statuses=[result],
                extra_condition="#token = :token", extra_names={"#token": prefix + "_token"}, extra_values={":token": token})
    return receipt

def lambda_handler(event, context):
    result = event.get("result")
    if result not in {"safe", "quarantined"}:
        raise PipelineConflict("invalid_notification_result")
    source, row = notification_source(event)
    from pipeline_common import verify_rescan_execution
    verify_rescan_execution(row, event)
    if row["status"] != result or row.get("upload_state") not in {"uploading", "uploaded", "unknown"}:
        raise PipelineConflict("notification_status_mismatch")
    if result == "quarantined" and row.get("quarantine_status") != "completed":
        raise PipelineConflict("quarantine_not_completed")
    subject, body = build_message(result, row)
    receipts = {}
    for channel, sender in (("sns", send_sns), ("webhook", send_webhook)):
        if channel == "webhook" and not WEBHOOK_URL:
            receipts[channel] = "skipped"
            continue
        receipts[channel] = delivery(source, result, channel, sender, subject, body)
        saved = read_file(_table(FILES_TABLE), source)
        put_audit(_table(AUDIT_TABLE), source, f"notify_{result}_{channel}", result,
                  {"channel": channel, "receipt": receipts[channel]}, saved[f"notify_{result}_{channel}_sent_at"],
                  execution_id=row.get("execution_id"))
    delivered_at = max(saved[f"notify_{result}_{channel}_sent_at"] for channel in ("sns", "webhook")
                       if not (channel == "webhook" and not WEBHOOK_URL))
    put_audit(_table(AUDIT_TABLE), source, "notify_" + result, result,
              {"sns_message_id": receipts["sns"], "webhook": receipts["webhook"]},
              delivered_at,
              execution_id=row.get("execution_id"))
    return {"notified": True, "sns_message_id": receipts["sns"], "webhook": receipts["webhook"]}

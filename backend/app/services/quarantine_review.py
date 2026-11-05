"""One review at a time per quarantined version, with an atomic audit entry."""

from typing import Literal
from uuid import uuid4

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field

from ..db import DynamoDBError, call_dynamodb, file_key, serialize_item, utc_timestamp
from .lifecycle import notification_put


class ReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    reason: str = Field(min_length=1, max_length=500)


class ReviewDecision(ReviewRequest):
    decision: Literal["keep_quarantine", "restore"]


def review_view(item):
    review = item.get("quarantine_review")
    if review and review.get("version") == item.get("quarantine_version_id"):
        return {key: value for key, value in review.items() if key != "version"}
    return None


def is_restored(item):
    return (item.get("status") == "quarantined"
            and (review_view(item) or {}).get("status") == "restored")


def quarantine_location(item, settings):
    prefix = f"uploads/{item['owner_id']}/{item['file_id']}/"
    source = item.get("key", "")
    source_version = item.get("source_version_id")
    bucket, key, version = (item.get(name) for name in (
        "quarantine_bucket", "quarantine_key", "quarantine_version_id",
    ))
    if (item.get("storage") != "s3" or not bucket or bucket != settings.quarantine_bucket_name
            or bucket == settings.s3_bucket_name or item.get("upload_bucket") != settings.s3_bucket_name
            or not isinstance(source, str) or not source.startswith(prefix)
            or not source[len(prefix):] or "/" in source[len(prefix):]
            or not source_version or not version or version == "null"
            or key != source + ".version-" + str(source_version)):
        raise HTTPException(503, "Vị trí hoặc phiên bản cách ly không khớp cấu hình")
    return {"Bucket": bucket, "Key": key, "VersionId": version}


def verify_restorable(item, settings, storage):
    location = quarantine_location(item, settings)
    client = getattr(storage, "client", None)
    if client is None:
        raise HTTPException(503, "Chưa cấu hình kết nối S3 để khôi phục tệp")
    body = None
    try:
        result = client.get_object(**location, Range="bytes=0-0")
        body = result["Body"]
        readable = len(body.read(1)) == 1
    except (ClientError, BotoCoreError):
        raise HTTPException(502, "Chưa xác minh được bản cách ly. Hãy thử khôi phục lại.") from None
    finally:
        if body is not None:
            body.close()
    if (not readable or result.get("VersionId") != location["VersionId"]
            or result.get("ContentRange") != f"bytes 0-0/{item.get('size_bytes')}"):
        raise HTTPException(409, "Phiên bản hoặc dung lượng bản cách ly không khớp")


def save_review(metadata, audit, item, actor, payload):
    if (item.get("status") != "quarantined" or item.get("upload_state") != "uploaded"
            or item.get("lifecycle_state", "active") != "active" or not item.get("quarantine_version_id")):
        raise HTTPException(409, "Tệp chưa có bản cách ly có thể xem xét")
    previous = review_view(item)
    deciding = isinstance(payload, ReviewDecision)
    if deciding and (not previous or previous["status"] not in {"pending", "recommend_release"}):
        raise HTTPException(409, "Tệp không có yêu cầu đang chờ xử lý")
    if not deciding and previous:
        return previous
    owner, ident = item["owner_id"], item["file_id"]
    timestamp = utc_timestamp()
    version = item["quarantine_version_id"]
    decision_status = ("restored" if payload.decision == "restore" else "keep_quarantine") if deciding else "pending"
    review = ({**previous, "status": decision_status, "decision_reason": payload.reason,
               "decided_at": timestamp, "decided_by": actor} if deciding else {
                   "id": str(uuid4()), "status": "pending", "reason": payload.reason, "requested_at": timestamp,
               })
    condition = ("#status = :quarantined AND upload_state = :uploaded AND quarantine_version_id = :version "
                 "AND (attribute_not_exists(lifecycle_state) OR lifecycle_state = :active)")
    values = {":quarantined": "quarantined", ":uploaded": "uploaded", ":version": version,
              ":active": "active", ":review": {**review, "version": version}}
    names = {"#status": "status"}
    if deciding:
        condition += " AND quarantine_review.#id = :id AND quarantine_review.#status = :pending"
        names["#id"] = "id"
        values.update({":id": previous["id"], ":pending": previous["status"]})
        values[":at"] = timestamp
        if decision_status == "restored":
            condition += " AND quarantine_bucket = :bucket AND quarantine_key = :key"
            values.update({":bucket": item["quarantine_bucket"], ":key": item["quarantine_key"]})
    else:
        condition += " AND (attribute_not_exists(quarantine_review) OR quarantine_review.#version <> :version)"
        names["#version"] = "version"
    action = "quarantine_review_decided" if deciding else "quarantine_review_requested"
    changes = [
            {"Update": {
                "TableName": metadata.table_name,
                "Key": serialize_item(file_key(owner, ident)),
                "ConditionExpression": condition,
                "UpdateExpression": ("SET quarantine_review = :review, updated_at = :at"
                                     if deciding else "SET quarantine_review = :review"),
                "ExpressionAttributeNames": names,
                "ExpressionAttributeValues": serialize_item(values),
            }},
            audit.event_put(owner, ident, f"{review['id']}:{action}", action, actor, timestamp,
                            {"review_status": review["status"], "quarantine_version_id": version}),
    ]
    if deciding:
        name = item.get("display_name") or item["original_name"]
        restored = decision_status == "restored"
        changes.append(notification_put(
            metadata, owner, ident, f"review-{review['id']}", timestamp, "quarantine-review",
            "Tệp đã được khôi phục" if restored else "Quyết định giữ cách ly",
            f"{name}. Lý do: {payload.reason}", "success" if restored else "warning",
        ))
    try:
        call_dynamodb(metadata.client, "transact_write_items", TransactItems=changes)
    except DynamoDBError as exc:
        if exc.code == "TransactionCanceledException":
            raise HTTPException(409, "Yêu cầu đã thay đổi. Hãy tải lại trước khi tiếp tục.") from None
        raise
    return review

"""Durable per-owner quota. Pending/ambiguous uploads reserve their entire size."""
from contextlib import contextmanager
import time
from uuid import uuid4

from ..db import DynamoDBConflict, DynamoDBError, call_dynamodb, serialize_item

FREE_STORAGE_BYTES = 1_000_000_000


class QuotaExceeded(Exception):
    pass


class QuotaBusy(Exception):
    pass


def usage(metadata, owner_id):
    used = reserved = 0
    cursor = None
    while True:
        page = metadata.list_files(owner_id, limit=100, start_key=cursor)
        for item in page.items:
            if item.get("upload_state") == "failed":
                continue
            size = item.get("size_bytes")
            if type(size) is not int or size <= 0:
                raise DynamoDBError("quota", "InvalidFileSize")
            if item.get("upload_state") == "uploaded":
                used += size
            else:
                reserved += size
        cursor = page.next_key
        if not cursor:
            break
    return quota_view(used, reserved)


def quota_view(used, reserved=0):
    return {"limit_bytes": FREE_STORAGE_BYTES, "used_bytes": used,
            "reserved_bytes": reserved,
            "available_bytes": max(0, FREE_STORAGE_BYTES - used - reserved)}


def lock_key(owner_id):
    # A separate partition keeps the internal lock out of the owner's file list.
    return {"owner_id": f"!quota!{owner_id}", "file_id": "lock"}


@contextmanager
def reserve_upload(metadata, owner_id, size):
    token = uuid4().hex
    key = serialize_item(lock_key(owner_id))
    deadline = time.monotonic() + 4
    while True:
        try:
            call_dynamodb(metadata.client, "put_item", TableName=metadata.table_name,
                          Item={**key, **serialize_item({"token": token, "expires": int(time.time()) + 60})},
                          ConditionExpression="attribute_not_exists(#token) OR #expires < :now",
                          ExpressionAttributeNames={"#token": "token", "#expires": "expires"},
                          ExpressionAttributeValues=serialize_item({":now": int(time.time())}))
            break
        except DynamoDBConflict:
            if time.monotonic() >= deadline:
                raise QuotaBusy() from None
            time.sleep(0.05)
    try:
        if size > usage(metadata, owner_id)["available_bytes"]:
            raise QuotaExceeded()
        # create_upload_record checks this fencing token in the SAME transaction
        # as its Put. An expired/replaced lock can never admit a stale upload.
        yield {"key": key, "token": token}
    finally:
        try:
            call_dynamodb(metadata.client, "delete_item", TableName=metadata.table_name, Key=key,
                          ConditionExpression="#token = :token",
                          ExpressionAttributeNames={"#token": "token"},
                          ExpressionAttributeValues=serialize_item({":token": token}))
        except DynamoDBError:
            # The lease will expire; never hide an ambiguous reservation write.
            pass

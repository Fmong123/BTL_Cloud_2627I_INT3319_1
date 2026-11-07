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


def usage(metadata, owner_id, *, config=None):
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
    config = quota_config(metadata, owner_id) if config is None else config
    return quota_view(used, reserved, config.get("limit_bytes", FREE_STORAGE_BYTES))


def quota_view(used, reserved=0, limit=FREE_STORAGE_BYTES):
    return {"limit_bytes": limit, "used_bytes": used,
            "reserved_bytes": reserved,
            "available_bytes": max(0, limit - used - reserved)}


def quota_config(metadata, owner_id):
    item = metadata.get_file(f"!quota!{owner_id}", "settings") or {}
    if "limit_bytes" in item and (type(item["limit_bytes"]) is not int or item["limit_bytes"] < 0):
        raise DynamoDBError("quota", "InvalidQuota")
    return item


def lock_key(owner_id):
    # A separate partition keeps the internal lock out of the owner's file list.
    return {"owner_id": f"!quota!{owner_id}", "file_id": "lock"}


@contextmanager
def quota_lock(metadata, owner_id, *, seconds=60):
    token = uuid4().hex
    key = serialize_item(lock_key(owner_id))
    deadline = time.monotonic() + 4
    while True:
        try:
            call_dynamodb(metadata.client, "put_item", TableName=metadata.table_name,
                          Item={**key, **serialize_item({"token": token, "expires": int(time.time()) + seconds})},
                          ConditionExpression="attribute_not_exists(#token) OR #expires < :now",
                          ExpressionAttributeNames={"#token": "token", "#expires": "expires"},
                          ExpressionAttributeValues=serialize_item({":now": int(time.time())}))
            break
        except DynamoDBConflict:
            if time.monotonic() >= deadline:
                raise QuotaBusy() from None
            time.sleep(0.05)
    try:
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


@contextmanager
def reserve_upload(metadata, owner_id, size):
    with quota_lock(metadata, owner_id) as lease:
        if size > usage(metadata, owner_id)["available_bytes"]:
            raise QuotaExceeded()
        yield lease


def lease_check(metadata, lease):
    return {"ConditionCheck": {
        "TableName": metadata.table_name, "Key": lease["key"],
        "ConditionExpression": "#token=:token AND expires >= :now",
        "ExpressionAttributeNames": {"#token": "token"},
        "ExpressionAttributeValues": serialize_item({":token": lease["token"], ":now": int(time.time())}),
    }}

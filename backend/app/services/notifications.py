"""Shared admin inbox, per-admin read receipts and owner-only durable notices."""
from fastapi import HTTPException
from ..db import file_key, serialize_item, call_dynamodb
from .lifecycle import notification_put

# A reserved UUID partition fits the existing notification IAM scope. Never a login owner.
ADMIN_OWNER = "00000000-0000-0000-0000-000000000000"
ADMIN_KIND = "admin-review-request"


def review_notification(metadata, owner, ident, review, timestamp, name):
    return notification_put(metadata, ADMIN_OWNER, ident, "review-" + review["id"], timestamp,
        ADMIN_KIND, "Yêu cầu xem xét cách ly mới", name, "warning",
        target_owner_id=owner, destination="admin/quarantine")


def admin_visible(row, accounts, actor):
    return (accounts.get(actor, {}).get("role") == "admin"
            and accounts.get(actor, {}).get("active") is True
            and accounts.get(row.get("target_owner_id"), {}).get("role") == "user")


def public_notice(row):
    keys = ("id", "created_at", "kind", "title", "message", "tone", "read", "folder_id",
            "destination", "target_owner_id", "server_event")
    return {k: row[k] for k in keys if k in row} | {"file_id": row.get("target_file_id"), "read": row.get("read", False)}


def acknowledge_admin(metadata, actor, payload, accounts):
    key = f"{payload.created_at}#{payload.id}"
    original = metadata.get_file(f"!notifications!{ADMIN_OWNER}", key)
    if not original or not admin_visible(original, accounts, actor):
        raise HTTPException(403, "Thông báo không thuộc phạm vi quản trị hiện tại")
    if payload.read:
        row = {**original, **file_key(f"!notifications!{actor}", key), "read": True}
        # Keep canonical content/target and monotonic read state; retries are harmless.
        call_dynamodb(metadata.client, "put_item", TableName=metadata.table_name, Item=serialize_item(row))
        return public_notice(row)
    receipt = metadata.get_file(f"!notifications!{actor}", key)
    return public_notice({**original, "read": bool(receipt and receipt.get("read"))})

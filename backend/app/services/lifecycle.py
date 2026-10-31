"""File names, recoverable trash and confirmed erasure. Never moves object keys."""
from datetime import datetime, timedelta
import unicodedata

from ..db import (
    DynamoDBConflict, call_dynamodb, deserialize_item, file_key,
    query_page, query_parameters, serialize_item, utc_timestamp,
)
from .storage import LocalStorage, StorageFailure, StorageUnavailable

RETENTION_DAYS = 30
HISTORY_FIELDS = (
    "owner_id", "file_id", "original_name", "display_name", "name_updated_at", "key",
    "storage", "size_bytes", "content_type", "upload_state", "status", "created_at",
    "updated_at", "findings_count", "finding_types", "status_reason", "scanned_at",
    "quarantined_at", "starred", "starred_updated_at", "trashed_at", "trash_expires_at",
    "lifecycle_state", "lifecycle_updated_at",
)


class LifecycleConflict(Exception):
    pass


def validate_name(value):
    value = unicodedata.normalize("NFC", value).strip()
    if (not value or value in {".", ".."} or len(value) > 255
            or value.endswith(".") or any(c in value for c in '/\\:*?"<>|')
            or any(unicodedata.category(c).startswith("C") for c in value)):
        raise ValueError("Tên tệp không hợp lệ; không dùng ký tự / \\ : * ? \" < > |")
    return value


def state(item):
    return item.get("lifecycle_state", "active")


def expired(item, now=None):
    return bool(item.get("trash_expires_at") and item["trash_expires_at"] <= utc_timestamp(now))


class FileLifecycle:
    def __init__(self, metadata, storage, settings):
        self.metadata, self.storage, self.settings = metadata, storage, settings

    def change(self, item, fields, *, expected_states, require_idle=False):
        names = {"#owner": "owner_id", "#life": "lifecycle_state"}
        values, sets = {}, []
        for index, (name, value) in enumerate(fields.items()):
            names[f"#n{index}"], values[f":v{index}"] = name, value
            sets.append(f"#n{index} = :v{index}")
        terms = []
        for index, life in enumerate(expected_states):
            values[f":l{index}"] = life
            terms.append(f"#life = :l{index}")
            if life == "active":
                terms.append("attribute_not_exists(#life)")
        condition = "attribute_exists(#owner) AND (" + " OR ".join(terms) + ")"
        names["#life_at"] = "lifecycle_updated_at"
        if item.get("lifecycle_updated_at") is not None:
            values[":expected_life_at"] = item["lifecycle_updated_at"]
            condition += " AND #life_at = :expected_life_at"
        else:
            condition += " AND attribute_not_exists(#life_at)"
        if require_idle:
            names.update({"#upload": "upload_state", "#scan": "status"})
            values.update({":uploaded": "uploaded", ":failed": "failed", ":scanning": "scanning", ":flagged": "flagged"})
            condition += " AND #upload IN (:uploaded, :failed) AND #scan <> :scanning AND #scan <> :flagged"
        try:
            response = call_dynamodb(self.metadata.client, "update_item",
                TableName=self.metadata.table_name,
                Key=serialize_item(file_key(item["owner_id"], item["file_id"])),
                UpdateExpression="SET " + ", ".join(sets), ConditionExpression=condition,
                ExpressionAttributeNames=names, ExpressionAttributeValues=serialize_item(values),
                ReturnValues="ALL_NEW")
        except DynamoDBConflict:
            raise LifecycleConflict("Tệp đã đổi trạng thái hoặc đang xử lý — hãy làm mới danh sách") from None
        return deserialize_item(response["Attributes"])

    def rename(self, item, name):
        return self.change(item, {"display_name": validate_name(name), "name_updated_at": utc_timestamp()},
                           expected_states=["active"])

    def trash(self, item):
        if state(item) == "trashed":
            return item  # Retry must not extend the thirty-day deadline.
        stamp = utc_timestamp()
        expiry = utc_timestamp((datetime.fromisoformat(stamp.replace("Z", "+00:00"))
                                + timedelta(days=RETENTION_DAYS)).isoformat())
        return self.change(item, {"lifecycle_state": "trashed", "trashed_at": stamp,
            "trash_expires_at": expiry, "lifecycle_updated_at": stamp},
            expected_states=["active"], require_idle=True)

    def restore(self, item):
        if state(item) == "active":
            return item
        if expired(item):
            raise LifecycleConflict("Tệp đã hết thời hạn khôi phục 30 ngày")
        # A concurrent deletion changes life to deleting before touching bytes.
        return self.change(item, {"lifecycle_state": "active", "lifecycle_updated_at": utc_timestamp()},
                           expected_states=["trashed"])

    def purge(self, item):
        if state(item) not in {"trashed", "deleting"}:
            raise LifecycleConflict("Chuyển tệp vào Thùng rác trước khi xóa vĩnh viễn")
        prefix = f"uploads/{item['owner_id']}/{item['file_id']}/"
        file_key(item["owner_id"], item["file_id"])
        if not item.get("key", "").startswith(prefix):
            raise StorageFailure("Invalid file location")
        if item["storage"] != self.storage.mode:
            raise StorageUnavailable("Storage adapter mismatch")
        if item["storage"] == "s3":
            if item.get("upload_bucket") != self.settings.s3_bucket_name:
                raise StorageUnavailable("Upload bucket mismatch")
            quarantine = item.get("quarantine_bucket")
            if quarantine and quarantine != self.settings.quarantine_bucket_name:
                raise StorageUnavailable("Quarantine bucket is not configured")
            if item.get("status") in {"quarantined", "quarantine_delete_failed"} and not quarantine:
                raise StorageUnavailable("Quarantine location is missing")
        claimed = self.change(item, {"lifecycle_state": "deleting", "lifecycle_updated_at": utc_timestamp()},
                              expected_states=["trashed", "deleting"], require_idle=True)
        if isinstance(self.storage, LocalStorage):
            self.storage.delete_file(prefix=prefix)
        elif self.storage.mode == "s3":
            buckets = {self.settings.s3_bucket_name}
            if item.get("quarantine_bucket"):
                buckets.add(item["quarantine_bucket"])
            for bucket in buckets:
                self.storage.delete_file_versions(bucket=bucket, prefix=prefix)
        else:
            raise StorageUnavailable("Deletion is not configured")
        # Preserve a minimal upload-history snapshot, atomically with metadata
        # removal. Quota continues counting if bytes or this transaction fail.
        snapshot = {k: claimed[k] for k in HISTORY_FIELDS if k in claimed}
        snapshot.update(owner_id=f"!history!{item['owner_id']}", lifecycle_state="purged")
        call_dynamodb(self.metadata.client, "transact_write_items", TransactItems=[
            {"Put": {"TableName": self.metadata.table_name, "Item": serialize_item(snapshot)}},
            {"Delete": {"TableName": self.metadata.table_name,
                "Key": serialize_item(file_key(item["owner_id"], item["file_id"])),
                "ConditionExpression": "#life = :deleting",
                "ExpressionAttributeNames": {"#life": "lifecycle_state"},
                "ExpressionAttributeValues": serialize_item({":deleting": "deleting"})}},
        ])
        return {"id": item["file_id"], "deleted": True}


def history_page(metadata, owner, *, limit, start_key):
    """Archived (erased) uploads; active uploads remain in the owner's partition."""
    page = metadata.list_files(f"!history!{owner}", limit=limit, start_key=start_key)
    for item in page.items:
        item["owner_id"] = owner
    return page


def save_notification(metadata, owner, data):
    # Separate partition: user notifications can never enter quota/file lists.
    key = file_key(f"!notifications!{owner}", f"{data['created_at']}#{data['id']}")
    names, values, sets = {}, {}, []
    for index, (name, value) in enumerate(data.items()):
        if name == "read" and value is False:
            continue
        names[f"#n{index}"], values[f":v{index}"] = ("target_file_id" if name == "file_id" else name), value
        sets.append(f"#n{index} = " + (f"if_not_exists(#n{index}, :v{index})" if name in {"id", "created_at"}
                    else f":v{index}"))
    response = call_dynamodb(metadata.client, "update_item", TableName=metadata.table_name,
        Key=serialize_item(key), UpdateExpression="SET " + ", ".join(sets),
        ExpressionAttributeNames=names, ExpressionAttributeValues=serialize_item(values),
        ReturnValues="ALL_NEW")
    row = deserialize_item(response["Attributes"])
    return {k: v for k, v in row.items()
            if k not in {"owner_id", "file_id", "target_file_id"}} | {"file_id": row.get("target_file_id")}


def notification_page(metadata, owner, *, limit, start_key):
    params = query_parameters("owner_id", f"!notifications!{owner}", "file_id",
                              limit=limit, start_key=start_key)
    return query_page(call_dynamodb(metadata.client, "query", TableName=metadata.table_name,
                                   ScanIndexForward=False, **params))

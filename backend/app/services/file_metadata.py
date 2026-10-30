"""File metadata repository; does not upload bytes or write audit automatically."""

from ..db import (
    QueryPage, call_dynamodb, deserialize_item, file_key, query_page,
    query_parameters, require_table, require_text, serialize_item, utc_timestamp,
)


class FileMetadataRepository:
    def __init__(self, client, table_name: str):
        require_table(client, table_name)
        self.client = client
        self.table_name = table_name

    def create_upload_record(
        self, *, owner_id: str, file_id: str, original_name: str, key: str,
        size_bytes: int, content_type: str, storage: str,
        upload_bucket: str | None = None, pipeline_enabled: bool = False,
        created_at: str | None = None, record_type: str | None = None,
    ) -> dict:
        identity = file_key(owner_id, file_id)
        require_text(original_name, "original_name")
        require_text(content_type, "content_type")
        require_text(key, "key")
        prefix = f"uploads/{owner_id}/{file_id}/"
        filename = key[len(prefix):] if key.startswith(prefix) else ""
        if not filename or filename in {".", ".."} or "/" in filename or "\\" in filename:
            raise ValueError("key must match uploads/{owner_id}/{file_id}/{filename}")
        if type(size_bytes) is not int or size_bytes <= 0:
            raise ValueError("size_bytes must be a positive integer")
        if storage not in {"local", "s3"}:
            raise ValueError("storage must be local or s3")
        if type(pipeline_enabled) is not bool or (pipeline_enabled and storage != "s3"):
            raise ValueError("pipeline_enabled requires S3 storage")
        if storage == "s3":
            require_text(upload_bucket, "upload_bucket")
        elif upload_bucket is not None:
            raise ValueError("Local storage must not specify an S3 bucket")
        timestamp = utc_timestamp(created_at)
        record = {
            **identity, "original_name": original_name, "key": key,
            "size_bytes": size_bytes, "content_type": content_type, "storage": storage,
            "upload_state": "uploading",
            "status": "scanning" if pipeline_enabled else "not_started",
            "findings_count": 0, "finding_types": [],
            "created_at": timestamp, "updated_at": timestamp,
            "created_order": f"{timestamp}#{file_id}",
            "status_time": f"{timestamp}#{file_id}",
        }
        if upload_bucket is not None:
            record["upload_bucket"] = upload_bucket
        if record_type is not None:
            record["record_type"] = require_text(record_type, "record_type")
        call_dynamodb(
            self.client, "put_item", TableName=self.table_name,
            Item=serialize_item(record),
            ConditionExpression="attribute_not_exists(#owner) AND attribute_not_exists(#file)",
            ExpressionAttributeNames={"#owner": "owner_id", "#file": "file_id"},
        )
        return record

    def get_file(self, owner_id: str, file_id: str) -> dict | None:
        response = call_dynamodb(
            self.client, "get_item", TableName=self.table_name,
            Key=serialize_item(file_key(owner_id, file_id)), ConsistentRead=True,
        )
        item = response.get("Item")
        return deserialize_item(item) if item is not None else None

    def list_files(
        self, owner_id: str, *, limit: int = 20, start_key: dict | None = None,
    ) -> QueryPage:
        file_key(owner_id, "validation-only")
        return query_page(call_dynamodb(
            self.client, "query", TableName=self.table_name,
            **query_parameters("owner_id", owner_id, "file_id", limit=limit, start_key=start_key),
        ))

    def mark_upload_completed(
        self, owner_id: str, file_id: str, *, updated_at: str | None = None,
    ) -> dict:
        """Only update upload fields, even if a scanner has already marked the file safe."""
        return self._mark_upload(owner_id, file_id, "uploaded", updated_at=updated_at)

    def set_starred(self, owner_id: str, file_id: str, starred: bool) -> dict:
        """Atomically change preferences without touching the scanner's version/state."""
        if type(starred) is not bool:
            raise ValueError("starred must be a boolean")
        response = call_dynamodb(
            self.client, "update_item", TableName=self.table_name,
            Key=serialize_item(file_key(owner_id, file_id)),
            UpdateExpression="SET #starred = :starred, #starred_updated = :timestamp",
            ConditionExpression="attribute_exists(#owner) AND attribute_exists(#file)",
            ExpressionAttributeNames={
                "#owner": "owner_id", "#file": "file_id", "#starred": "starred",
                "#starred_updated": "starred_updated_at",
            },
            ExpressionAttributeValues=serialize_item({
                ":starred": starred, ":timestamp": utc_timestamp(),
            }),
            ReturnValues="ALL_NEW",
        )
        return deserialize_item(response["Attributes"])

    def mark_upload_failed(
        self, owner_id: str, file_id: str, *, outcome_unknown: bool = False,
        updated_at: str | None = None,
    ) -> dict:
        """Keep uncertain storage writes distinct; never downgrade an uploaded record."""
        if type(outcome_unknown) is not bool:
            raise ValueError("outcome_unknown must be a boolean")
        return self._mark_upload(
            owner_id, file_id, "unknown" if outcome_unknown else "failed", updated_at=updated_at,
        )

    def _mark_upload(self, owner_id, file_id, state, *, updated_at):
        response = call_dynamodb(
            self.client, "update_item", TableName=self.table_name,
            Key=serialize_item(file_key(owner_id, file_id)),
            UpdateExpression="SET #upload = :target, #updated = :updated",
            ConditionExpression=(
                "attribute_exists(#owner) AND attribute_exists(#file) "
                "AND #upload IN (:uploading, :unknown, :target)"
            ),
            ExpressionAttributeNames={
                "#owner": "owner_id", "#file": "file_id",
                "#upload": "upload_state", "#updated": "updated_at",
            },
            ExpressionAttributeValues=serialize_item({
                ":target": state, ":updated": utc_timestamp(updated_at),
                ":uploading": "uploading", ":unknown": "unknown",
            }),
            ReturnValues="ALL_NEW",
        )
        return deserialize_item(response["Attributes"])

    def mark_pending_scan_failed(
        self, owner_id: str, file_id: str, *, reason: str,
        updated_at: str | None = None,
    ) -> dict:
        """Resolve a definitely failed upload, without replacing a scanner result.

        Called only after upload_state=failed was confirmed. An uncertain storage
        outcome must be reconciled instead of declaring a failed scan.
        """
        timestamp = utc_timestamp(updated_at)
        response = call_dynamodb(
            self.client, "update_item", TableName=self.table_name,
            Key=serialize_item(file_key(owner_id, file_id)),
            UpdateExpression=(
                "SET #status = :error, #reason = :reason, #updated = :updated, #time = :time"
            ),
            ConditionExpression=(
                "attribute_exists(#owner) AND attribute_exists(#file) "
                "AND #upload = :failed AND #status = :scanning"
            ),
            ExpressionAttributeNames={
                "#owner": "owner_id", "#file": "file_id", "#upload": "upload_state",
                "#status": "status", "#reason": "status_reason",
                "#updated": "updated_at", "#time": "status_time",
            },
            ExpressionAttributeValues=serialize_item({
                ":failed": "failed", ":scanning": "scanning", ":error": "error",
                ":reason": require_text(reason, "reason"), ":updated": timestamp,
                ":time": f"{timestamp}#{file_id}",
            }),
            ReturnValues="ALL_NEW",
        )
        return deserialize_item(response["Attributes"])

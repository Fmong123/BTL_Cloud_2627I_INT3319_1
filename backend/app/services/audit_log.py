"""Append-only audit repository. Reuse event_id and occurred_at when retrying."""

from typing import Mapping

from ..db import (
    DynamoDBConflict, QueryPage, call_dynamodb, file_key, query_page,
    query_parameters, require_table, require_text, serialize_item, utc_timestamp,
)


class AuditLogRepository:
    def __init__(self, client, table_name: str):
        require_table(client, table_name)
        self.client = client
        self.table_name = table_name

    def write_event(
        self, *, owner_id: str, file_id: str, event_id: str, occurred_at: str,
        action: str, actor: str, details: Mapping | None = None,
        execution_id: str | None = None, from_status: str | None = None,
        to_status: str | None = None, record_type: str | None = None,
    ) -> bool:
        """True: created; False: identical event exists; changed payload: conflict.

        Details must already be sanitized by the caller (no raw PII or webhook secrets).
        No automatic timestamp/event ID is generated, so retries can be deterministic.
        """
        identity = file_key(owner_id, file_id)
        require_text(event_id, "event_id")
        require_text(occurred_at, "occurred_at")
        require_text(action, "action")
        require_text(actor, "actor")
        if details is not None and not isinstance(details, Mapping):
            raise ValueError("details must be a mapping")
        timestamp = utc_timestamp(occurred_at)
        record = {
            **identity, "event_key": f"{timestamp}#{event_id}",
            "occurred_at": timestamp, "action": action, "actor": actor,
            "details": dict(details) if details is not None else {},
        }
        for name, value in (
            ("execution_id", execution_id), ("from_status", from_status),
            ("to_status", to_status), ("record_type", record_type),
        ):
            if value is not None:
                record[name] = require_text(value, name)
        try:
            call_dynamodb(
                self.client, "put_item", TableName=self.table_name,
                Item=serialize_item(record),
                ConditionExpression="attribute_not_exists(#file) AND attribute_not_exists(#event)",
                ExpressionAttributeNames={"#file": "file_id", "#event": "event_key"},
                ReturnValuesOnConditionCheckFailure="ALL_OLD",
            )
        except DynamoDBConflict as exc:
            if exc.existing_item == record:
                return False
            raise
        return True

    def list_history(
        self, file_id: str, *, limit: int = 20, start_key: dict | None = None,
    ) -> QueryPage:
        """Caller must authorize access to this file before requesting its history."""
        file_key("validation-only", file_id)
        return query_page(call_dynamodb(
            self.client, "query", TableName=self.table_name,
            **query_parameters("file_id", file_id, "event_key", limit=limit, start_key=start_key),
        ))

"""DynamoDB primitives. Importing this module never creates a client."""

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Mapping

import boto3
from boto3.dynamodb.types import TypeDeserializer, TypeSerializer
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from .config import Settings


class DynamoDBError(Exception):
    """Provider failure; callers must reconcile ambiguous writes before retrying."""

    def __init__(self, operation: str, code: str, *, write_outcome_unknown: bool = False):
        self.operation = operation
        self.code = code
        self.write_outcome_unknown = write_outcome_unknown
        super().__init__(f"DynamoDB {operation} failed ({code})")


class DynamoDBConflict(DynamoDBError):
    """A conditional write was rejected; the existing item was not replaced."""

    def __init__(self, operation: str, existing_item: dict | None = None):
        self.existing_item = existing_item
        super().__init__(operation, "ConditionalCheckFailedException")


@dataclass(frozen=True)
class QueryPage:
    items: list[dict[str, Any]]
    next_key: dict[str, Any] | None


def build_dynamodb_client(settings: Settings, *, session=None):
    """Return None when disabled. The caller owns and must close a created client."""
    if settings.metadata_mode == "disabled":
        return None
    provider = session if session is not None else boto3
    try:
        return provider.client(
            "dynamodb",
            region_name=settings.dynamodb_region,
            config=Config(
                connect_timeout=3,
                read_timeout=5,
                retries={"mode": "standard", "total_max_attempts": 3},
            ),
        )
    except BotoCoreError as exc:
        raise DynamoDBError("create_client", type(exc).__name__) from exc


def require_text(value: str, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string")
    return value


def file_key(owner_id: str, file_id: str) -> dict[str, str]:
    for name, value in (("owner_id", owner_id), ("file_id", file_id)):
        require_text(value, name)
        if value in {".", ".."} or "/" in value or "\\" in value:
            raise ValueError(f"{name} must be one storage-key segment")
    return {"owner_id": owner_id, "file_id": file_id}


def require_table(client, table_name: str) -> None:
    if client is None:
        raise ValueError("DynamoDB is disabled or no client was supplied")
    if not require_text(table_name, "table_name").startswith("securedrive-"):
        raise ValueError("DynamoDB table names must start with securedrive-")


def utc_timestamp(value: str | None = None) -> str:
    instant = datetime.now(timezone.utc) if value is None else datetime.fromisoformat(
        require_text(value, "timestamp").replace("Z", "+00:00")
    )
    if instant.tzinfo is None or instant.utcoffset() is None:
        raise ValueError("timestamp must include a timezone")
    return instant.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def serialize_item(item: Mapping[str, Any]) -> dict:
    serializer = TypeSerializer()
    return {name: serializer.serialize(value) for name, value in item.items()}


def _native(value):
    if isinstance(value, Decimal) and value == value.to_integral_value():
        return int(value)
    if isinstance(value, dict):
        return {name: _native(child) for name, child in value.items()}
    if isinstance(value, list):
        return [_native(child) for child in value]
    return value


def deserialize_item(item: Mapping[str, Any]) -> dict:
    deserializer = TypeDeserializer()
    return {name: _native(deserializer.deserialize(value)) for name, value in item.items()}


def call_dynamodb(client, operation: str, **kwargs) -> dict:
    """Keep provider messages out of public error text; preserve causes for diagnosis."""
    writing = operation in {"put_item", "update_item"}
    try:
        return getattr(client, operation)(**kwargs)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "ClientError")
        if code == "ConditionalCheckFailedException":
            old = exc.response.get("Item")
            raise DynamoDBConflict(
                operation, deserialize_item(old) if old is not None else None
            ) from exc
        status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode", 0)
        raise DynamoDBError(
            operation, code, write_outcome_unknown=writing and status >= 500
        ) from exc
    except BotoCoreError as exc:
        raise DynamoDBError(
            operation, type(exc).__name__, write_outcome_unknown=writing
        ) from exc


def query_parameters(
    partition_name: str, partition_value: str, sort_name: str,
    *, limit: int, start_key: dict | None,
) -> dict:
    require_text(partition_value, partition_name)
    if type(limit) is not int or not 1 <= limit <= 100:
        raise ValueError("limit must be an integer between 1 and 100")
    params = {
        "KeyConditionExpression": "#partition = :partition",
        "ExpressionAttributeNames": {"#partition": partition_name},
        "ExpressionAttributeValues": serialize_item({":partition": partition_value}),
        "Limit": limit,
        "ConsistentRead": True,
    }
    if start_key is not None:
        if not isinstance(start_key, dict) or set(start_key) != {partition_name, sort_name}:
            raise ValueError("Invalid pagination key")
        if start_key[partition_name] != partition_value:
            raise ValueError("Pagination key belongs to another partition")
        require_text(start_key[sort_name], sort_name)
        params["ExclusiveStartKey"] = serialize_item(start_key)
    return params


def query_page(response: dict) -> QueryPage:
    next_key = response.get("LastEvaluatedKey")
    return QueryPage(
        items=[deserialize_item(item) for item in response.get("Items", [])],
        next_key=deserialize_item(next_key) if next_key else None,
    )

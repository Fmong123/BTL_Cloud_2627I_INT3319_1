"""Shared contract; include this module at the root of EACH Lambda ZIP."""

import hashlib
from datetime import datetime, timezone
from decimal import Decimal
from urllib.parse import unquote_plus

from botocore.exceptions import ClientError


class PipelineConflict(Exception):
    """Missing/mismatched metadata, stale execution, or conflicting replay."""


def verify_rescan_execution(row, event):
    if row.get("scan_request_id") and row.get("execution_id") != (event.get("ctx") or {}).get("execution"):
        raise PipelineConflict("stale_rescan_execution")


def utc(value=None):
    instant = datetime.now(timezone.utc) if value is None else datetime.fromisoformat(value.replace("Z", "+00:00"))
    if instant.tzinfo is None:
        raise ValueError("timestamp_requires_timezone")
    return instant.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def ids_from_key(key):
    parts = key.split("/") if isinstance(key, str) else []
    if len(parts) != 4 or parts[0] != "uploads" or any(not p or p in {".", ".."} or "\\" in p for p in parts):
        raise PipelineConflict("invalid_upload_key")
    return parts[1], parts[2]


def source_from_event(event):
    if event.get("Records"):
        raw = event["Records"][0]["s3"]
        bucket = raw["bucket"]["name"]
        obj = raw["object"]
        key = unquote_plus(obj["key"])
        version = obj.get("versionId")
    else:
        detail = event.get("detail", event)
        bucket = detail.get("bucket")
        bucket = bucket.get("name") if isinstance(bucket, dict) else bucket
        obj = detail.get("object") or {}
        # EventBridge keys are literal. Only S3 Records use form URL encoding.
        key = obj.get("key") or detail.get("key")
        version = obj.get("version-id") or detail.get("source_version_id") or detail.get("version_id")
    if not isinstance(bucket, str) or not bucket:
        raise PipelineConflict("missing_upload_bucket")
    owner_id, file_id = ids_from_key(key)
    for name, actual in (("owner_id", owner_id), ("file_id", file_id)):
        if event.get(name, actual) != actual:
            raise PipelineConflict("event_identity_mismatch")
    if version == "null":
        version = None
    if version is not None and (not isinstance(version, str) or not version):
        raise PipelineConflict("invalid_source_version")
    return {"owner_id": owner_id, "file_id": file_id, "bucket": bucket, "key": key, "version": version}


def file_key(source):
    return {name: source[name] for name in ("owner_id", "file_id")}


def read_file(table, source):
    row = table.get_item(Key=file_key(source), ConsistentRead=True).get("Item")
    if not row or row.get("storage") != "s3" or row.get("key") != source["key"] or row.get("upload_bucket") != source["bucket"]:
        raise PipelineConflict("metadata_source_mismatch")
    if row.get("lifecycle_state", "active") != "active":
        raise PipelineConflict("file_in_trash")
    if row.get("source_version_id") and row["source_version_id"] != source["version"]:
        raise PipelineConflict("source_version_mismatch")
    return row


def update_file(table, source, fields, *, statuses, remove=(), execution=None, extra_condition=None, extra_names=None, extra_values=None):
    """Never upsert an incomplete file or mutate a different object/execution."""
    names = {"#owner": "owner_id", "#file": "file_id", "#key": "key", "#bucket": "upload_bucket", "#storage": "storage", "#status": "status", "#version": "source_version_id", "#life": "lifecycle_state"}
    values = {":key": source["key"], ":bucket": source["bucket"], ":storage": "s3", ":active": "active"}
    conditions = ["attribute_exists(#owner)", "attribute_exists(#file)", "#key = :key", "#bucket = :bucket", "#storage = :storage", "(attribute_not_exists(#life) OR #life = :active)"]
    if source.get("version"):
        values[":version"] = source["version"]
        conditions.append("(attribute_not_exists(#version) OR #version = :version)")
    else:
        conditions.append("attribute_not_exists(#version)")
    allowed = []
    for i, status in enumerate(statuses):
        values[f":allowed{i}"] = status
        allowed.append(f":allowed{i}")
    conditions.append("#status IN (" + ", ".join(allowed) + ")")
    if execution:
        names["#execution"] = "execution_id"
        values[":execution"] = execution
        conditions.append("(attribute_not_exists(#execution) OR #execution = :execution)")
    sets = []
    for i, (name, value) in enumerate(fields.items()):
        names[f"#set{i}"] = name
        values[f":set{i}"] = value
        sets.append(f"#set{i} = :set{i}")
    expression = "SET " + ", ".join(sets)
    if remove:
        for i, name in enumerate(remove):
            names[f"#remove{i}"] = name
        expression += " REMOVE " + ", ".join(f"#remove{i}" for i in range(len(remove)))
    if extra_condition:
        conditions.append(extra_condition)
    names.update(extra_names or {})
    values.update(extra_values or {})
    return table.update_item(Key=file_key(source), UpdateExpression=expression,
                             ConditionExpression=" AND ".join(conditions),
                             ExpressionAttributeNames=names, ExpressionAttributeValues=values,
                             ReturnValues="ALL_NEW")["Attributes"]


def status_fields(status, file_id, timestamp=None):
    timestamp = utc(timestamp)
    return {"status": status, "updated_at": timestamp, "status_time": f"{timestamp}#{file_id}"}


def summary(row):
    count = row.get("findings_count", 0)
    if isinstance(count, bool) or not isinstance(count, (int, Decimal)) or count < 0 or int(count) != count:
        raise PipelineConflict("invalid_findings_count")
    types = row.get("finding_types", [])
    if not isinstance(types, list) or any(not isinstance(t, str) for t in types):
        raise PipelineConflict("invalid_finding_types")
    return {"findings_count": int(count), "finding_types": sorted(set(types))}


def conditional_failure(exc):
    return isinstance(exc, ClientError) and exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException"


def put_audit(table, source, action, status, details, occurred_at, *, execution_id=None, suffix=""):
    timestamp = utc(occurred_at)
    logical = "|".join((source["file_id"], source.get("version") or "unversioned", action, suffix))
    event_id = hashlib.sha256(logical.encode()).hexdigest()
    actor = {"scan": "securedrive-scan-pii", "quarantine": "securedrive-quarantine-file", "notify": "securedrive-notify"}[action.split("_")[0]]
    item = {**file_key(source), "event_key": f"{timestamp}#{event_id}", "event_id": event_id,
            "occurred_at": timestamp, "actor": "lambda:" + actor,
            "action": action, "status": status, "to_status": status, "details": details}
    if execution_id:
        item["execution_id"] = execution_id
    try:
        table.put_item(Item=item, ConditionExpression="attribute_not_exists(file_id) AND attribute_not_exists(event_key)",
                       ReturnValuesOnConditionCheckFailure="ALL_OLD")
    except ClientError as exc:
        if not conditional_failure(exc):
            raise
        old = exc.response.get("Item")
        if old:
            from boto3.dynamodb.types import TypeDeserializer
            old = {k: TypeDeserializer().deserialize(v) for k, v in old.items()}
        else:
            old = table.get_item(Key={"file_id": source["file_id"], "event_key": item["event_key"]}, ConsistentRead=True).get("Item")
        # execution_id can differ for a replay of the same logical result.
        if not old or any(old.get(k) != item.get(k) for k in ("owner_id", "file_id", "action", "status", "details")):
            raise PipelineConflict("audit_replay_conflict") from exc

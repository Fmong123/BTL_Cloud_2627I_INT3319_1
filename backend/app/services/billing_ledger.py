"""Financial byte intervals only: never filenames, contents or scan findings."""
from ..db import serialize_item, call_dynamodb, DynamoDBConflict


def interval_action(metadata, owner, ident, size, begin, end=None, *, processing_pending=False, processing_record=None):
    values = {":size": size, ":begin": begin}
    expression = "SET size_bytes=:size, begins_at=if_not_exists(begins_at,:begin)"
    if end is not None:
        expression += ", ends_at=if_not_exists(ends_at,:end)"
        values[":end"] = end
    if processing_pending:
        expression += ", processing_pending=:pending"
        values[":pending"] = True
        if processing_record:
            expression += ", pending_processing_record=:record"
            values[":record"] = processing_record
    return {"Update": {"TableName": metadata.table_name,
        "Key": serialize_item({"owner_id": f"!quota!{owner}", "file_id": f"billing-file-{ident}"}),
        "UpdateExpression": expression, "ExpressionAttributeValues": serialize_item(values)}}


def seed_interval(metadata, owner, row, baseline):
    if row.get("upload_state") != "uploaded":
        return
    end = row.get("billing_deleted_at")
    if row.get("lifecycle_state") == "purged" and not end:
        return
    record = {"owner_id": f"!quota!{owner}", "file_id": f"billing-file-{row['file_id']}",
        "size_bytes": row["size_bytes"], "begins_at": row.get("billing_uploaded_at") or baseline}
    if end:
        record["ends_at"] = end
    try:
        call_dynamodb(metadata.client, "put_item", TableName=metadata.table_name,
            Item=serialize_item(record), ConditionExpression="attribute_not_exists(file_id)")
    except DynamoDBConflict:
        pass  # Never overwrite an interval closed by a concurrent purge.


def processing_put(metadata, owner, record):
    fields = ("owner_id", "file_id", "occurred_at", "scan_status", "extraction_method", "extracted_pages")
    if (not isinstance(record, dict) or set(record) != set(fields)
            or record["owner_id"] != f"!quota!{owner}"
            or not isinstance(record["file_id"], str) or not record["file_id"].startswith("billing-scan-")
            or type(record["extracted_pages"]) is not int or record["extracted_pages"] < 0):
        raise ValueError("Invalid processing usage record")
    try:
        call_dynamodb(metadata.client, "put_item", TableName=metadata.table_name,
            Item=serialize_item(record), ConditionExpression="attribute_not_exists(file_id)")
    except DynamoDBConflict:
        pass

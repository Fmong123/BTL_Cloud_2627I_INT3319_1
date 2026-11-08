"""Recover usage from durable scan results/audit without replaying the scan."""
from ..db import DynamoDBConflict, DynamoDBError, call_dynamodb, serialize_item
from .billing_ledger import processing_put


def repair_owner(metadata, audit, owner, *, former=False, intervals=None):
    from .billing import all_items, account, ledger_rows, instant
    active = [] if former else all_items(metadata, owner)
    rows = ledger_rows(metadata, owner, account(metadata, owner), active=None if former else active)
    known = {r["file_id"] for r in rows if r["file_id"].startswith("billing-scan-")}
    candidates = {r["file_id"]: r for r in active if r.get("billing_usage_pending")}
    for row in rows:
        if row["file_id"].startswith("billing-file-") and (former or row.get("processing_pending")):
            if former and not any(instant(row["begins_at"]) < instant(i["end"]) and (not row.get("ends_at") or instant(row["ends_at"]) > instant(i["start"])) for i in intervals or []):
                continue
            candidates.setdefault(row["file_id"][len("billing-file-"):], row)
    repaired = 0
    for ident, source in candidates.items():
        records = []
        pending = source.get("billing_processing_record") or source.get("pending_processing_record")
        if pending:
            records.append(pending)
        if audit is None:
            raise DynamoDBError("billing_repair", "AuditUnavailable")
        cursor, seen = None, set()
        for _ in range(200):
            page = audit.list_history(ident, limit=100, start_key=cursor)
            for event in page.items:
                record = (event.get("details") or {}).get("billing_processing")
                if event.get("owner_id") == owner and isinstance(record, dict):
                    records.append(record)
            cursor = page.next_key
            if not cursor:
                break
            signature = str(sorted(cursor.items()))
            if signature in seen:
                raise DynamoDBError("billing_repair", "RepeatedCursor")
            seen.add(signature)
        else:
            raise DynamoDBError("billing_repair", "AuditScopeTooLarge")
        def allowed(record):
            at = instant(record["occurred_at"])
            return not former or any(instant(i["start"]) <= at and (not i.get("end") or at < instant(i["end"])) for i in intervals or [])
        for record in records:
            if not allowed(record):
                continue
            if record["file_id"] not in known:
                processing_put(metadata, owner, record)
                known.add(record["file_id"])
                repaired += 1
        if source.get("billing_usage_pending") and (not pending or pending["file_id"] in known):
            try:
                call_dynamodb(metadata.client, "update_item", TableName=metadata.table_name,
                    Key=serialize_item({"owner_id": owner, "file_id": ident}),
                    UpdateExpression="SET billing_usage_pending=:no",
                    ConditionExpression="attribute_exists(file_id) AND scanned_at=:at",
                    ExpressionAttributeValues=serialize_item({":no": False, ":at": source["scanned_at"]}))
            except DynamoDBConflict:
                pass  # A new scan or purge won; its pending marker remains durable.
        elif source.get("processing_pending") and (not pending or pending["file_id"] in known or not allowed(pending)):
            call_dynamodb(metadata.client, "update_item", TableName=metadata.table_name,
                Key=serialize_item({"owner_id": f"!quota!{owner}", "file_id": f"billing-file-{ident}"}),
                UpdateExpression="SET processing_pending=:no", ExpressionAttributeValues=serialize_item({":no": False}))
    return repaired

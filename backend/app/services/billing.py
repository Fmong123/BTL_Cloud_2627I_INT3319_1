"""Storage-time estimates, not payments. Immutable rates are developer-owned.

File sizes are immutable. Confirmed upload/erasure timestamps therefore form a
durable usage ledger without a second counter that can drift on retries.
"""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
import json
import logging
import zlib
import hashlib
from pathlib import Path

from ..db import DynamoDBConflict, DynamoDBError, call_dynamodb, serialize_item, utc_timestamp
from .quota import FREE_STORAGE_BYTES, quota_lock, lease_check, usage, QuotaBusy
from .lifecycle import notification_put
from .billing_ledger import seed_interval

TZ = timezone(timedelta(hours=7))
POLICY = json.loads((Path(__file__).resolve().parents[1] / "assets" / "billing-policy.json").read_text(encoding="utf-8"))
VERSION = POLICY["version"]
STORAGE_RATE = POLICY["storage_rate"]
MANAGEMENT_RATE = POLICY["management_rate"]
TRIAL_LIMIT = POLICY["trial_limit_bytes"]
if POLICY["free_bytes"] != FREE_STORAGE_BYTES:
    raise ValueError("Billing policy and storage quota must use the same free allowance")
ADMIN_OWNER = "00000000-0000-0000-0000-000000000000"
logger = logging.getLogger(__name__)


class PreferencesConflict(Exception):
    pass


def instant(value):
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("Timestamp must be timezone-aware")
    return result.astimezone(timezone.utc)


def rounded(value):
    return int(Decimal(value).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def seconds(start, end):
    delta = end - start
    return Decimal(delta.days * 86400 + delta.seconds) + Decimal(delta.microseconds) / 1_000_000


def window(month=None, now=None):
    now = now or datetime.now(timezone.utc)
    local = now.astimezone(TZ)
    start = datetime.strptime(month, "%Y-%m").replace(tzinfo=TZ) if month else local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if start > local:
        raise ValueError("Không thể xem kỳ trong tương lai")
    end = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    return start, end, min(end, now)


def account(metadata, owner, now=None):
    key = {"owner_id": f"!quota!{owner}", "file_id": "billing"}
    row = metadata.get_file(**key)
    if row:
        return row
    row = {**key, "started_at": utc_timestamp(now), "policy_version": VERSION,
           "storage_rate": STORAGE_RATE, "management_rate": MANAGEMENT_RATE,
           "payg_enabled": False, "budget_vnd": 100_000, "preferences_revision": 0}
    try:
        call_dynamodb(metadata.client, "put_item", TableName=metadata.table_name,
                      Item=serialize_item(row), ConditionExpression="attribute_not_exists(file_id)")
        return row
    except DynamoDBConflict:
        return metadata.get_file(**key)


def all_items(metadata, owner):
    items, cursor, seen = [], None, set()
    while True:
        page = metadata.list_files(owner, limit=100, start_key=cursor)
        items.extend(page.items)
        if len(items) > 20_000:
            raise DynamoDBError("billing", "UsageScopeTooLarge")
        cursor = page.next_key
        if not cursor:
            return items
        signature = str(sorted(cursor.items()))
        if signature in seen:
            raise DynamoDBError("billing", "RepeatedCursor")
        seen.add(signature)


def ledger_rows(metadata, owner, config, *, active=None):
    rows = all_items(metadata, f"!quota!{owner}")
    if active is not None:
        # Migrate erased history once; heal only missing active records afterwards.
        known = {row["file_id"] for row in rows}
        files = {r["file_id"]: r for r in active}
        if not config.get("ledger_ready"):
            for row in all_items(metadata, f"!history!{owner}"):
                files[row["file_id"]] = row
        missing = [r for r in files.values() if f"billing-file-{r['file_id']}" not in known
                   and r.get("upload_state") == "uploaded"]
        for row in missing:
            seed_interval(metadata, owner, row, config["started_at"])
        if not config.get("ledger_ready"):
            call_dynamodb(metadata.client, "update_item", TableName=metadata.table_name,
                Key=serialize_item({"owner_id": f"!quota!{owner}", "file_id": "billing"}),
                UpdateExpression="SET ledger_ready=:ready", ConditionExpression="attribute_exists(file_id)",
                ExpressionAttributeValues=serialize_item({":ready": True}))
        if missing:
            rows = all_items(metadata, f"!quota!{owner}")
    return rows


def file_intervals(metadata, owner, baseline, cutoff, *, financial_only=False, rows=None):
    # Read active before archived: a concurrent purge can appear twice, but never
    # omit the file in both queries. The archived record wins deduplication.
    if rows is None and not financial_only:
        rows = {r["file_id"]: r for r in all_items(metadata, owner)}
        for row in all_items(metadata, f"!history!{owner}"):
            rows[row["file_id"]] = row
        for row in rows.values():
            seed_interval(metadata, owner, row, utc_timestamp(baseline.isoformat()))
    result = []
    for row in rows if rows is not None else all_items(metadata, f"!quota!{owner}"):
        if not row["file_id"].startswith("billing-file-"):
            continue
        size = row.get("size_bytes")
        if type(size) is not int or size <= 0:
            raise DynamoDBError("billing", "InvalidFileSize")
        # Legacy timestamps are not inferred from updated_at (scan/rename can
        # change it). Existing bytes start at the account's metering baseline.
        begin = max(baseline, instant(row["begins_at"]))
        finish = min(cutoff, instant(row["ends_at"])) if row.get("ends_at") else cutoff
        if finish > begin:
            result.append((begin, finish, size))
    return result


def integrate(intervals, start, cutoff, month_end, rate, enabled_since=None):
    """Sweep the TOTAL bytes, subtracting the free allowance once per account."""
    events = defaultdict(int)
    events[start] += 0
    events[cutoff] += 0
    day = start
    while day < cutoff:
        events[day] += 0
        day += timedelta(days=1)
    if enabled_since and start < enabled_since < cutoff:
        events[enabled_since] += 0
    for begin, finish, size in intervals:
        begin, finish = max(begin, start), min(finish, cutoff)
        if finish > begin:
            events[begin] += size
            events[finish] -= size
    used, total, daily = 0, Decimal(0), defaultdict(Decimal)
    points = sorted(events)
    duration = seconds(start, month_end)
    for index, point in enumerate(points[:-1]):
        used += events[point]
        finish = points[index + 1]
        chargeable = max(0, used - FREE_STORAGE_BYTES) if enabled_since and point >= enabled_since else 0
        byte_seconds = Decimal(chargeable) * seconds(point, finish)
        daily[point.astimezone(TZ).strftime("%Y-%m-%d")] += byte_seconds
        total += byte_seconds
    denominator = Decimal(FREE_STORAGE_BYTES) * duration
    return total * rate / denominator, [{"date": key, "storage_vnd": rounded(value * rate / denominator)} for key, value in sorted(daily.items())]


def summary(metadata, owner, month=None, now=None, *, financial_only=False, through=None, managed_intervals=None):
    now = now or datetime.now(timezone.utc)
    config = account(metadata, owner, now.isoformat())
    start, end, cutoff = window(month, now)
    if through:
        cutoff = max(start, min(cutoff, through))
    baseline = instant(config["started_at"])
    enabled = instant(config["activated_at"]) if config.get("payg_enabled") else None
    active = all_items(metadata, owner) if not financial_only else None
    rows = ledger_rows(metadata, owner, config, active=active)
    intervals = file_intervals(metadata, owner, baseline, cutoff, rows=rows)
    if managed_intervals is not None:
        intervals = [(max(begin, instant(i["start"])), min(finish, instant(i["end"]) if i.get("end") else cutoff), size)
            for begin, finish, size in intervals for i in managed_intervals
            if min(finish, instant(i["end"]) if i.get("end") else cutoff) > max(begin, instant(i["start"]))]
    fee, daily = integrate(intervals, start, cutoff, end, config["storage_rate"], enabled)
    current = usage(metadata, owner, items=active) if active is not None else None
    remaining = max(Decimal(0), seconds(max(now, start), end)) if now < end else Decimal(0)
    future = (Decimal(max(0, current["used_bytes"] - FREE_STORAGE_BYTES)) / FREE_STORAGE_BYTES
              * config["storage_rate"] * remaining / seconds(start, end)) if enabled and current else Decimal(0)
    return {
        "month": start.strftime("%Y-%m"), "as_of": utc_timestamp(now.isoformat()),
        "period_start": utc_timestamp(start.isoformat()), "period_end": utc_timestamp(end.isoformat()),
        "tracking_started_at": config["started_at"], "policy_version": config["policy_version"],
        "payg_enabled": config.get("payg_enabled", False), "activated_at": config.get("activated_at"),
        "storage_rate": config["storage_rate"], "free_bytes": FREE_STORAGE_BYTES,
        "budget_vnd": config.get("budget_vnd", 100_000), "usage": current,
        "preferences_revision": config.get("preferences_revision", 0),
        "billable_bytes": max(0, current["used_bytes"] - FREE_STORAGE_BYTES) if enabled and current else 0,
        "storage_vnd": rounded(fee), "forecast_vnd": rounded(fee + future),
        "daily": daily, "estimate_only": True, "historical": now >= end,
        "processing": processing_usage(metadata, owner, start, cutoff, managed_intervals, rows=rows),
        "processing_pending": pending_processing(rows, active or [], start, cutoff, managed_intervals),
    }


def processing_usage(metadata, owner, start, cutoff, managed_intervals=None, *, rows=None):
    stats = {"scan_runs": 0, "ocr_runs": 0, "ocr_extracted_pages": 0, "error_runs": 0, "processing_vnd": 0}
    for row in rows if rows is not None else all_items(metadata, f"!quota!{owner}"):
        if not row["file_id"].startswith("billing-scan-"):
            continue
        at = instant(row["occurred_at"])
        if not start <= at < cutoff:
            continue
        if managed_intervals is not None and not any(instant(i["start"]) <= at < (instant(i["end"]) if i.get("end") else cutoff) for i in managed_intervals):
            continue
        stats["scan_runs"] += 1
        if row.get("extraction_method") in {"textract_image", "textract_pdf"}:
            stats["ocr_runs"] += 1
            stats["ocr_extracted_pages"] += row.get("extracted_pages", 0)
        if row.get("scan_status") in {"error", "unscanned"}:
            stats["error_runs"] += 1
    return stats


def pending_processing(rows, active, start, cutoff, managed_intervals):
    pending = set()
    for row in [*rows, *active]:
        if not row.get("processing_pending") and not row.get("billing_usage_pending"):
            continue
        record = row.get("billing_processing_record") or row.get("pending_processing_record")
        if record:
            at = instant(record["occurred_at"])
            if not start <= at < cutoff:
                continue
            if managed_intervals is not None and not any(instant(i["start"]) <= at and (not i.get("end") or at < instant(i["end"])) for i in managed_intervals):
                continue
        pending.add(record["file_id"] if record else row["file_id"])
    return len(pending)


def activate(metadata, owner, policy_version, request_id, now=None, *, audit=None):
    if policy_version != VERSION:
        raise ValueError("Chính sách đã thay đổi. Hãy đọc lại bảng giá trước khi xác nhận.")
    account(metadata, owner, now)
    with quota_lock(metadata, owner) as lease:
        row = metadata.get_file(f"!quota!{owner}", "billing")
        if row.get("payg_enabled"):
            return  # Repeated confirmations never move the charge start.
        stamp = utc_timestamp(now)
        actions = [lease_check(metadata, lease), {"Update": {"TableName": metadata.table_name,
            "Key": serialize_item({"owner_id": f"!quota!{owner}", "file_id": "billing"}),
            "UpdateExpression": "SET payg_enabled=:on, activated_at=:at, activation_request_id=:id, policy_version=:v, storage_rate=:s, management_rate=:m",
            "ExpressionAttributeValues": serialize_item({":on": True, ":at": stamp, ":id": request_id,
                ":v": VERSION, ":s": STORAGE_RATE, ":m": MANAGEMENT_RATE})}}]
        quota = metadata.get_file(f"!quota!{owner}", "settings") or {}
        # Never override an explicit administrative restriction.
        if "limit_bytes" not in quota:
            actions.append({"Update": {"TableName": metadata.table_name,
                "Key": serialize_item({"owner_id": f"!quota!{owner}", "file_id": "settings"}),
                "UpdateExpression": "SET limit_bytes=:limit", "ConditionExpression": "attribute_not_exists(limit_bytes)",
                "ExpressionAttributeValues": serialize_item({":limit": TRIAL_LIMIT})}})
        actions.append(notification_put(metadata, owner, None, f"billing-activated-{request_id}", stamp,
            "billing-activated", "Đã bật tính phí theo sử dụng", "Chỉ hiển thị chi phí dự kiến; chưa thu tiền. Hạn mức do quản trị viên cấp vẫn được giữ.", "info", destination="costs"))
        if audit:
            actions.append(audit.event_put(owner, owner, request_id, "billing_activated", owner, stamp,
                {"policy_version": policy_version, "limit_bytes": quota.get("limit_bytes", TRIAL_LIMIT)}))
        call_dynamodb(metadata.client, "transact_write_items", TransactItems=actions)


def preferences(metadata, audit, owner, budget, revision, request_id, now=None):
    account(metadata, owner, now)
    with quota_lock(metadata, owner) as lease:
        row = account(metadata, owner)
        if row.get("budget_request_id") == request_id:
            if row["budget_vnd"] != budget:
                raise PreferencesConflict()
            return {"budget_vnd": budget, "preferences_revision": row.get("preferences_revision", 0)}
        if row.get("preferences_revision", 0) != revision:
            raise PreferencesConflict()
        stamp = utc_timestamp(now)
        call_dynamodb(metadata.client, "transact_write_items", TransactItems=[lease_check(metadata, lease),
            {"Update": {"TableName": metadata.table_name,
                "Key": serialize_item({"owner_id": f"!quota!{owner}", "file_id": "billing"}),
                "UpdateExpression": "SET budget_vnd=:b, preferences_revision=:r, budget_request_id=:id",
                "ExpressionAttributeValues": serialize_item({":b": budget, ":r": revision + 1, ":id": request_id})}},
            audit.event_put(owner, owner, request_id, "billing_budget_changed", owner, stamp,
                {"before_vnd": row["budget_vnd"], "after_vnd": budget}),
        ])
    return {"budget_vnd": budget, "preferences_revision": revision + 1}


def cost_alert(metadata, owner, data, *, admin=False, now=None):
    """One forecast and one accrued warning per month and saved budget revision."""
    config = account(metadata, owner, now)
    actual = data.get("total_vnd", data.get("storage_vnd", 0))
    forecast = data["forecast_vnd"]
    budget = config["budget_vnd"]
    level = 2 if actual > 0 and actual >= budget else 1 if forecast > 0 and forecast >= budget else 0
    if not level:
        return
    ident = f"billing-budget-{'admin' if admin else 'user'}-{data['month']}-{config.get('preferences_revision', 0)}"
    with quota_lock(metadata, owner) as lease:
        # A preference save during calculation invalidates the old evaluation.
        if account(metadata, owner).get("preferences_revision", 0) != config.get("preferences_revision", 0):
            return
        prior = metadata.get_file(f"!quota!{owner}", ident) or {}
        if prior.get("level", 0) >= level:
            return
        stamp = utc_timestamp(now)
        call_dynamodb(metadata.client, "transact_write_items", TransactItems=[lease_check(metadata, lease),
            {"Put": {"TableName": metadata.table_name, "Item": serialize_item({"owner_id": f"!quota!{owner}", "file_id": ident, "level": level})}},
            notification_put(metadata, owner, None, f"{ident}-{level}", stamp, "billing-cost-warning",
                "Chi phí đã đạt ngưỡng cảnh báo" if level == 2 else "Dự báo chi phí đạt ngưỡng cảnh báo",
                f"Kỳ {data['month']}: {'đã phát sinh' if level == 2 else 'dự báo'} {actual if level == 2 else forecast:,} đ; ngưỡng {budget:,} đ. Đây là ước tính, chưa thu tiền.",
                "warning", destination="admin/costs" if admin else "costs"),
        ])


def check_owner(metadata, owner):
    """Best effort after upload; durable reads and the worker retry failures."""
    try:
        data = summary(metadata, owner)
        storage_alert(metadata, owner, current=data["usage"])
        cost_alert(metadata, owner, data)
        return True
    except (DynamoDBError, ValueError, TypeError, QuotaBusy):
        logger.warning("Billing notification pending reconciliation")
        return False


def storage_alert(metadata, owner, now=None, *, current=None):
    """Persist one notice per crossed band; rearm only below 75% of free space."""
    with quota_lock(metadata, owner) as lease:
        current = usage(metadata, owner) if current is None else current
        size = current["used_bytes"]
        level = 100 if size >= FREE_STORAGE_BYTES else 90 if size >= 900_000_000 else 80 if size >= 800_000_000 else 0
        prior = metadata.get_file(f"!quota!{owner}", "billing-alerts") or {}
        old, cycle = prior.get("level", 0), prior.get("cycle", 0)
        if size < 750_000_000 and old:
            level, cycle = 0, cycle + 1
        elif level <= old:
            return
        if not level and not old:
            return
        stamp = utc_timestamp(now)
        marker = {"owner_id": f"!quota!{owner}", "file_id": "billing-alerts", "level": level, "cycle": cycle}
        actions = [lease_check(metadata, lease), {"Put": {"TableName": metadata.table_name, "Item": serialize_item(marker)}}]
        if level:
            actions.append(notification_put(metadata, owner, None, f"billing-free-{cycle}-{level}", stamp,
                "billing-storage-warning", "Đã hết mức lưu trữ miễn phí" if level == 100 else "Dung lượng miễn phí sắp đầy",
                f"Đã dùng {size / 1_000_000:g} MB; mức miễn phí là 1 GB. Xem chính sách hoặc dọn dữ liệu. Không tự bật trả phí.",
                "warning", destination="pricing"))
        call_dynamodb(metadata.client, "transact_write_items", TransactItems=actions)


def reconcile_roster(metadata, accounts, now=None, *, complete=True):
    now = now or datetime.now(timezone.utc)
    stamp = utc_timestamp(now.isoformat())
    users = {k: v for k, v in accounts.items() if v.get("role") == "user"}
    if len(users) > 200:
        raise ValueError("Bản demo hỗ trợ tối đa 200 user trong báo cáo chi phí")
    # Durable observed membership intervals, shared by every admin. Locking an
    # account does not remove it from management; external removal closes it at
    # first directory reconciliation, never at a guessed historical instant.
    with quota_lock(metadata, ADMIN_OWNER) as lease:
        roster = metadata.get_file(f"!quota!{ADMIN_OWNER}", "billing-roster") or {
            "owner_id": f"!quota!{ADMIN_OWNER}", "file_id": "billing-roster", "members": {},
            "tracking_started_at": stamp, "management_rate": MANAGEMENT_RATE}
        members = roster["members"]
        if len(set(members) | set(users)) > 200:
            raise ValueError("Lịch sử quản lý vượt giới hạn 200 tài khoản của bản demo")
        changed = "tracking_started_at" not in roster
        roster.setdefault("tracking_started_at", min((i["start"] for member in members.values()
            for i in member["intervals"]), default=stamp))
        for ident, user in users.items():
            if ident not in members:
                # Cognito account creation is not the date the user role began.
                # Never backcharge a former admin/newly assigned user from it.
                members[ident] = {"name": user.get("name") or ident, "intervals": [{"start": stamp}], "present": True}
                changed = True
            elif not members[ident]["present"]:
                members[ident]["intervals"].append({"start": stamp})
                members[ident]["present"] = True
                changed = True
        for ident, entry in members.items():
            if complete and ident not in users and entry["present"]:
                entry["intervals"][-1]["end"] = stamp
                entry["present"] = False
                changed = True
        if changed:
            call_dynamodb(metadata.client, "transact_write_items", TransactItems=[lease_check(metadata, lease),
                {"Put": {"TableName": metadata.table_name, "Item": serialize_item(roster)}}])
    return roster


def admin_summary(metadata, accounts, month=None, now=None):
    now = now or datetime.now(timezone.utc)
    stamp = utc_timestamp(now.isoformat())
    start, end, cutoff = window(month, now)
    roster = reconcile_roster(metadata, accounts, now)
    users = {k: v for k, v in accounts.items() if v.get("role") == "user"}
    period_key = {"owner_id": f"!quota!{ADMIN_OWNER}", "file_id": f"billing-period-{start:%Y-%m}"}
    sealed = metadata.get_file(**period_key)
    members = roster["members"]
    rows, storage_total, management_total, forecast_total = [], Decimal(0), Decimal(0), Decimal(0)
    for ident, entry in members.items():
        managed = sum((max(Decimal(0), seconds(max(start, instant(i["start"])), min(cutoff, instant(i["end"]) if i.get("end") else cutoff))) for i in entry["intervals"]), Decimal(0))
        if managed <= 0 and (now >= end or not entry["present"]):
            continue
        management = managed / seconds(start, end) * roster["management_rate"]
        # Current admin identities are excluded from private file inspection.
        if ident in users:
            config = account(metadata, ident)
            if now >= end and not config.get("ledger_ready"):
                ledger_rows(metadata, ident, config, active=all_items(metadata, ident))
            financial = summary(metadata, ident, month, now, financial_only=now >= end, managed_intervals=entry["intervals"])
            view = financial if now < end else None
        else:
            view = None
            financial = summary(metadata, ident, month, now, financial_only=True,
                through=instant(entry["intervals"][-1]["end"]), managed_intervals=entry["intervals"])
        storage = Decimal(financial["storage_vnd"])
        future_admin = (max(Decimal(0), seconds(max(now, start), end)) / seconds(start, end)
                        * roster["management_rate"]) if entry["present"] and now < end else Decimal(0)
        projected = Decimal(financial["forecast_vnd"])
        cost_view = {k: financial[k] for k in ("daily", "storage_vnd", "forecast_vnd", "payg_enabled", "policy_version", "processing", "processing_pending")}
        if now >= end:
            cost_view["payg_enabled"] = bool(financial.get("activated_at") and instant(financial["activated_at"]) < end)
        rows.append({"id": ident, "name": users.get(ident, {}).get("name") or entry["name"],
            "present": entry["present"] if now < end else any(instant(i["start"]) < end and (not i.get("end") or instant(i["end"]) >= end) for i in entry["intervals"]),
            "managed_since": entry["intervals"][0]["start"],
            "managed_days": float(managed / 86400), "management_vnd": rounded(management),
            "storage_vnd": rounded(storage), "summary": view, "cost_summary": cost_view,
            "forecast_vnd": rounded(projected) + rounded(management + future_admin)})
        storage_total += storage
        management_total += rounded(management)
        forecast_total += rows[-1]["forecast_vnd"]
    report = {"month": start.strftime("%Y-%m"), "as_of": stamp, "estimate_only": True,
        "policy_version": VERSION, "accounts_count": len(rows) if now >= end else len(users), "items": rows,
        "storage_vnd": rounded(storage_total), "management_vnd": rounded(management_total),
        "total_vnd": rounded(storage_total + management_total), "forecast_vnd": rounded(forecast_total),
        "used_bytes": sum(r["summary"]["usage"]["used_bytes"] for r in rows if r["summary"]),
        "historical": now >= end,
        "processing_pending": sum(row["cost_summary"]["processing_pending"] for row in rows),
        "processing": {key: sum(row["cost_summary"]["processing"][key] for row in rows)
                       for key in ("scan_runs", "ocr_runs", "ocr_extracted_pages", "error_runs", "processing_vnd")}}
    if now >= end:
        # Closed periods contain financial aggregates only, never private usage.
        for row in report["items"]:
            row["summary"] = None
        report["used_bytes"] = None
        report["settlement_status"] = "reconciling" if now < end + timedelta(minutes=5) or report["processing_pending"] else "reconciled"
        return save_period(metadata, period_key, report, sealed)
    report["settlement_status"] = "open"
    return report


def period_fingerprint(report):
    fields = ("storage_vnd", "management_vnd", "total_vnd", "forecast_vnd", "accounts_count", "processing", "processing_pending", "settlement_status")
    data = {k: report.get(k) for k in fields}
    data["items"] = [{k: r.get(k) for k in ("id", "storage_vnd", "management_vnd", "cost_summary", "managed_days")}
                     for r in sorted(report["items"], key=lambda r: r["id"])]
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def read_period(row):
    try:
        return json.loads(zlib.decompress(bytes(row["report_zlib"])))
    except (ValueError, TypeError, KeyError, zlib.error):
        raise DynamoDBError("billing_period", "InvalidSnapshot") from None


def period_versions(metadata, month, before=None, limit=5):
    key = {"owner_id": f"!quota!{ADMIN_OWNER}", "file_id": f"billing-period-{month}"}
    latest = metadata.get_file(**key)
    if not latest:
        return {"items": [], "next_before": None}
    newest = latest.get("revision", 1)
    first = newest if before is None else min(newest, before - 1)
    items = []
    for revision in range(first, max(0, first - limit), -1):
        row = latest if revision == newest else metadata.get_file(key["owner_id"], f"{key['file_id']}-r{revision}")
        if not row:
            raise DynamoDBError("billing_period", "MissingPeriodVersion")
        report = read_period(row)
        items.append({**{k: report.get(k) for k in ("as_of", "storage_vnd", "management_vnd", "total_vnd", "processing", "settlement_status", "adjustment_vnd")},
            "revision": revision, "latest": revision == newest})
    return {"items": items, "next_before": items[-1]["revision"] if items and items[-1]["revision"] > 1 else None}


def save_period(metadata, key, report, previous):
    """Reconcile late events with immutable versions; never silently rewrite history."""
    fingerprint = period_fingerprint(report)
    expected = previous.get("revision", 1) if previous else 0
    with quota_lock(metadata, ADMIN_OWNER) as lease:
        latest = metadata.get_file(**key)
        actual = latest.get("revision", 1) if latest else 0
        if actual != expected and latest is None:
            raise DynamoDBError("billing_period", "PeriodChanged")
        if actual != expected or (latest and latest.get("fingerprint") == fingerprint):
            saved = read_period(latest)
            saved["checked_at"] = max(saved["as_of"], report["as_of"])
            return saved
        report.update(report_revision=actual + 1, reconciled_at=report["as_of"])
        actions = [lease_check(metadata, lease)]
        if latest:
            prior = read_period(latest)
            report["previous_total_vnd"] = prior["total_vnd"]
            report["adjustment_vnd"] = report["total_vnd"] - prior["total_vnd"]
            actions.append({"Put": {"TableName": metadata.table_name,
                "Item": serialize_item({**key, "file_id": f"{key['file_id']}-r{actual}",
                    "report_zlib": latest["report_zlib"], "revision": actual}),
                "ConditionExpression": "attribute_not_exists(file_id)"}})
        actions.append({"Put": {"TableName": metadata.table_name,
            "Item": serialize_item({**key, "revision": report["report_revision"], "fingerprint": fingerprint,
                "report_zlib": zlib.compress(json.dumps(report).encode())})}})
        call_dynamodb(metadata.client, "transact_write_items", TransactItems=actions)
    return report


def reconcile(metadata, directory, audit=None):
    """Bounded periodic reconciliation, independent of visiting the costs page."""
    accounts = {a["id"]: a for a in directory.accounts(fresh=True)}
    roster = reconcile_roster(metadata, accounts)
    repaired, failed = 0, 0
    from .billing_reconciliation import repair_owner
    for owner, entry in roster["members"].items():
        try:
            repaired += repair_owner(metadata, audit, owner, former=not entry["present"], intervals=entry["intervals"])
        except (DynamoDBError, ValueError, TypeError, KeyError, QuotaBusy):
            failed += 1
            logger.warning("Processing usage repair deferred")
    report = admin_summary(metadata, accounts)
    for owner, user in accounts.items():
        if user.get("role") == "user":
            if not check_owner(metadata, owner):
                failed += 1
        elif user.get("role") == "admin" and user.get("active"):
            try:
                cost_alert(metadata, owner, report, admin=True)
            except (DynamoDBError, QuotaBusy):
                failed += 1
    now = datetime.now(TZ)
    previous = (now.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    admin_summary(metadata, accounts, previous)
    return {"owners_checked": len(roster["members"]), "repairs": repaired, "failed_checks": failed}


def reconciliation_status(app):
    state = app.state
    latest = state.file_metadata.get_file(f"!quota!{ADMIN_OWNER}", "billing-reconciliation") if state.file_metadata else None
    candidates = [getattr(state, "billing_monitor_status", {}), (latest or {}).get("status") or {}]
    status = dict(max(candidates, key=lambda r: max(r.get("last_started_at", ""), r.get("last_finished_at", ""))))
    status.setdefault("state", "unavailable")
    if not state.cognito_directory or not state.file_metadata:
        status["state"] = "unavailable"
    elif status.get("last_started_at") and seconds(instant(status["last_started_at"]), datetime.now(timezone.utc)) > 180:
        status["state"] = "delayed"
    return status


def run_reconciliation(app):
    state = app.state
    metadata = state.file_metadata
    if not metadata or not state.cognito_directory:
        raise DynamoDBError("billing_reconciliation", "DirectoryUnavailable")
    with quota_lock(metadata, ADMIN_OWNER, seconds=300, key_name="billing-monitor-lock") as lease:
        status = reconciliation_status(app)
        status.update(state="running", last_started_at=utc_timestamp())
        state.billing_monitor_status = dict(status)
        def persist():
            call_dynamodb(metadata.client, "transact_write_items", TransactItems=[lease_check(metadata, lease),
                {"Put": {"TableName": metadata.table_name, "Item": serialize_item({
                    "owner_id": f"!quota!{ADMIN_OWNER}", "file_id": "billing-reconciliation", "status": status})}}])
        try:
            persist()
            result = reconcile(metadata, state.cognito_directory, state.audit_log)
            status.update(result, state="degraded" if result["failed_checks"] else "ok", last_finished_at=utc_timestamp())
            if not result["failed_checks"]:
                status["last_success_at"] = status["last_finished_at"]
            persist()
        except Exception:
            status.update(state="error", last_finished_at=utc_timestamp())
            state.billing_monitor_status = dict(status)
            try:
                persist()
            except DynamoDBError:
                logger.warning("Cannot persist billing monitor status")
            raise
        finally:
            state.billing_monitor_status = dict(status)
    return status


async def monitor(app, stop):
    import asyncio
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=60)
            break
        except TimeoutError:
            pass
        try:
            await asyncio.to_thread(run_reconciliation, app)
        except QuotaBusy:
            pass  # Another worker/manual check holds the shared lease.
        except Exception:
            logger.warning("Billing reconciliation deferred; next cycle will retry")

"""Read-only administrative history projected from the existing append-only audit.

Never return provider payloads or arbitrary audit details to the browser. A fresh
directory scope is supplied by every endpoint, including detail and later pages.
"""
import base64
import hashlib
import json
import time as clock
import unicodedata
from datetime import date, datetime, time, timedelta
from uuid import UUID

from fastapi import HTTPException

from ..db import call_dynamodb, deserialize_item, serialize_item, utc_timestamp
from .admin_reports import VN

CATEGORIES = {"account": "Tài khoản & quota", "pipeline": "Xử lý tệp", "report": "Xuất dữ liệu", "trash": "Dọn Thùng rác"}
OUTCOMES = {"success": "Thành công", "failed": "Thất bại", "pending": "Đã ghi nhận yêu cầu",
            "unknown": "Chưa xác nhận", "closed": "Đã kết thúc"}
ACTIONS = {
    "account_quota_changed": ("account", "Thay đổi quota", "success"),
    "account_access_requested": ("account", "Yêu cầu đổi trạng thái tài khoản", "pending"),
    "account_access_changed": ("account", "Thay đổi trạng thái tài khoản", "success"),
    "admin_report_exported": ("report", "Xuất thống kê", "success"),
    "admin_quarantine_read_started": ("pipeline", "Yêu cầu đọc bản cách ly", "pending"),
    "admin_quarantine_read_completed": ("pipeline", "Đã đọc bản cách ly", "success"),
    "admin_quarantine_read_failed": ("pipeline", "Đọc bản cách ly thất bại", "failed"),
    "quarantine_review_decided": ("pipeline", "Quyết định xem xét cách ly", "success"),
    "rescan_requested": ("pipeline", "Yêu cầu quét lại", "pending"),
    "admin_scan_compression_requested": ("pipeline", "Yêu cầu nén lại tệp", "pending"),
    "admin_scan_compression_withdrawn": ("pipeline", "Thu hồi yêu cầu nén", "success"),
    "admin_scan_status_reconciled": ("pipeline", "Đối chiếu trạng thái quét", "success"),
    "admin_pipeline_requested": ("pipeline", "Yêu cầu xử lý lại", "pending"),
    "admin_pipeline_checked": ("pipeline", "Đối chiếu kết quả xử lý lại", "unknown"),
    "admin_notification_confirmed": ("pipeline", "Xác nhận thông báo theo bằng chứng", "success"),
    "quarantine_failed": ("pipeline", "Cách ly thất bại", "failed"),
    "quarantine_delete_failed": ("pipeline", "Xóa bản nguồn khi cách ly thất bại", "failed"),
    "quarantine_completed": ("pipeline", "Hoàn tất cách ly", "success"),
    "notify_failed": ("pipeline", "Gửi thông báo thất bại", "failed"),
    "notify_safe_sns": ("pipeline", "Gửi SNS cho kết quả quét", "success"),
    "notify_quarantined_sns": ("pipeline", "Gửi SNS cho tệp cách ly", "success"),
    "folder_purge_started": ("trash", "Bắt đầu dọn thư mục hết hạn", "pending"),
    "folder_purged": ("trash", "Đã dọn thư mục hết hạn", "success"),
}
SYSTEM_ACTORS = {
    "lambda:securedrive-quarantine-file": "Bộ cách ly tự động",
    "lambda:securedrive-notify": "Dịch vụ thông báo",
    "lambda:securedrive-trash-cleanup": "Dọn Thùng rác tự động",
}
SYSTEM_ACTIONS = {"quarantine_failed", "quarantine_delete_failed", "quarantine_completed", "notify_failed",
                  "notify_safe_sns", "notify_quarantined_sns", "folder_purge_started", "folder_purged"}
MAX_PAGES = 200
MAX_SECONDS = 20


def pack(value):
    return base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode()).decode().rstrip("=")


def unpack(value):
    try:
        parsed = json.loads(base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True))
        if not isinstance(parsed, dict):
            raise ValueError()
        return parsed
    except (ValueError, UnicodeError):
        raise HTTPException(400, "Mã lịch sử hoặc phân trang không hợp lệ") from None


def text(value, maximum=300):
    return "".join(c for c in value if c >= " " or c in "\n\t")[:maximum] if isinstance(value, str) else None


def number(value):
    return value if type(value) is int and value >= 0 else None


def normalized(value):
    return "".join(c for c in unicodedata.normalize("NFD", value.casefold().replace("đ", "d")) if not unicodedata.combining(c))


def allowed(row, accounts, actor_id, owner_id=None):
    action, owner, actor = row.get("action"), row.get("owner_id"), row.get("actor")
    if action not in ACTIONS:
        return False
    if action == "admin_report_exported":
        # Export audit lives under the exporting admin. Only their own record is
        # visible, and only if its original target is still in the user scope.
        details = row.get("details") or {}
        target = (details.get("filters") or {}).get("owner_id")
        return (owner == actor_id == actor and (target is None or accounts.get(target, {}).get("role") == "user")
                and (owner_id is None or owner_id == target))
    if accounts.get(owner, {}).get("role") != "user" or (owner_id and owner != owner_id):
        return False
    if action in SYSTEM_ACTIONS:
        return actor in SYSTEM_ACTORS and ((action.startswith("folder_") and actor == "lambda:securedrive-trash-cleanup")
                or (action.startswith("quarantine_") and actor == "lambda:securedrive-quarantine-file")
                or (action.startswith("notify_") and actor == "lambda:securedrive-notify"))
    # Personal rescans and folder activity are outside administrative history.
    try:
        UUID(actor)
    except (TypeError, ValueError, AttributeError):
        return False
    # These actions are written only by authenticated admin operations. Preserve
    # history after an actor leaves the directory or changes role, without
    # exposing that administrator's identity.
    return actor != owner


def project(row, accounts, actor_id):
    action = row["action"]
    category, label, outcome = ACTIONS[action]
    details = row.get("details") or {}
    owner = row["owner_id"]
    target = (details.get("filters") or {}).get("owner_id") if category == "report" else owner
    operation = {"retry_quarantine": "Thử lại cách ly", "retry_notification": "Gửi lại thông báo SNS"}.get(details.get("action"))
    if action == "admin_pipeline_requested" and operation:
        label = "Yêu cầu " + operation.lower()
    if action == "admin_pipeline_checked":
        outcome = {"succeeded": "success", "failed": "failed", "retired": "closed"}.get(details.get("result"), "unknown")
        if operation:
            label = "Đối chiếu: " + operation.lower()
    if action == "quarantine_review_decided":
        label = {"restored": "Khôi phục quyền truy cập tệp", "keep_quarantine": "Giữ tệp cách ly"}.get(details.get("review_status"), label)
    if action == "notify_failed" and details.get("delivery_state") != "failed":
        label, outcome = "Chưa xác nhận kết quả gửi thông báo", "unknown"
    actor = row.get("actor")
    return {"id": pack({"file_id": row["file_id"], "event_key": row["event_key"]}),
            "occurred_at": row["occurred_at"], "action": action, "action_label": label,
            "category": category, "category_label": CATEGORIES[category],
            "outcome": outcome, "outcome_label": OUTCOMES[outcome],
            "actor_name": "Bạn" if actor == actor_id else SYSTEM_ACTORS.get(actor, "Quản trị viên khác"),
            "actor_kind": "self" if actor == actor_id else ("system" if actor in SYSTEM_ACTORS else "admin"),
            "owner_id": target, "owner_name": accounts.get(target, {}).get("name") or "Tất cả người dùng",
            "owner_email": accounts.get(target, {}).get("email") or None,
            "target_id": None if category in {"account", "report"} else row["file_id"],
            "target_name": "Hạn mức lưu trữ" if action == "account_quota_changed" else (
                "Trạng thái truy cập" if category == "account" else ("Thống kê" if category == "report" else None))}


def target_name(metadata, row, event):
    if event["target_name"]:
        return
    if event["category"] == "trash":
        event["target_name"] = text((row.get("details") or {}).get("folder_name"), 120) or "Thư mục đã xóa"
        return
    # Resolve lazily only for authorized events, cache at the list call site.
    item = metadata.get_file(row["owner_id"], row["file_id"]) or metadata.get_file(f"!history!{row['owner_id']}", row["file_id"])
    event["target_name"] = text((item or {}).get("display_name") or (item or {}).get("original_name"), 255) or "Tệp đã xóa hoặc không còn metadata"


def detail(row, event):
    d, changes, facts = row.get("details") or {}, [], []
    def change(label, before, after):
        changes.append({"label": label, "before": before, "after": after})
    if event["action"] == "account_quota_changed":
        change("Hạn mức lưu trữ", number(d.get("before_bytes")), number(d.get("after_bytes")))
        changes[-1]["format"] = "bytes"
    elif event["action"] in {"account_access_requested", "account_access_changed"}:
        change("Trạng thái truy cập", ("Cho phép đăng nhập" if d["before_enabled"] else "Tạm khóa") if type(d.get("before_enabled")) is bool else None,
               ("Cho phép đăng nhập" if d["enabled"] else "Tạm khóa") if type(d.get("enabled")) is bool else None)
    elif event["action"] == "quarantine_review_decided":
        labels = {"pending": "Chờ xem xét", "recommend_release": "Đề xuất khôi phục", "restored": "Đã khôi phục", "keep_quarantine": "Giữ cách ly"}
        change("Xem xét cách ly", labels.get(d.get("before_review_status")), labels.get(d.get("review_status")))
    if event["category"] == "report":
        if d.get("format") in {"csv", "pdf"}:
            facts.append({"label": "Định dạng", "value": d["format"].upper()})
        if number(d.get("files")) is not None:
            facts.append({"label": "Số tệp trong báo cáo", "value": d["files"]})
        filters = d.get("filters") or {}
        for key, label in (("from", "Từ ngày"), ("to", "Đến ngày")):
            try:
                value = date.fromisoformat(filters.get(key, "")).strftime("%d/%m/%Y")
                facts.append({"label": label, "value": value})
            except (TypeError, ValueError):
                pass
    if d.get("channel") == "sns":
        facts.append({"label": "Kênh thông báo", "value": "SNS / email"})
    if d.get("execution_status") in {"SUCCEEDED", "FAILED", "TIMED_OUT", "ABORTED", "NOT_FOUND"}:
        labels = {"SUCCEEDED": "Hoàn tất", "FAILED": "Thất bại", "TIMED_OUT": "Hết thời gian", "ABORTED": "Đã dừng", "NOT_FOUND": "Không tìm thấy"}
        facts.append({"label": "Lượt chạy", "value": labels[d["execution_status"]]})
    reason = text(d.get("reason")) if event["actor_kind"] != "system" else None
    known_reasons = {"storage_read_failed": "Chưa đọc được bản cách ly từ kho lưu trữ", "size_limit": "Bản cách ly vượt giới hạn đọc"}
    reason = known_reasons.get(reason, reason)
    return {**event, "changes": changes, "facts": facts, "reason": reason,
            "note": "Đã ghi nhận yêu cầu; sự kiện này chưa xác nhận thao tác hoàn tất." if event["outcome"] == "pending" else (
                "Xác nhận do quản trị viên đối chiếu bằng chứng; không chứng minh người nhận đã đọc." if event["action"] == "admin_notification_confirmed" else None)}


def list_history(audit, metadata, accounts, actor_id, *, start, end, owner_id=None, category="all", outcome="all", q="", cursor=None, limit=20):
    if start > end or (end - start).days > 365 or end == date.max:
        raise HTTPException(400, "Chọn khoảng thời gian hợp lệ, tối đa 366 ngày")
    lower = utc_timestamp(datetime.combine(start, time.min, VN).isoformat())
    upper = utc_timestamp(datetime.combine(end + timedelta(days=1), time.min, VN).isoformat())
    scope = hashlib.sha256(json.dumps([actor_id, sorted((k, v.get("role")) for k, v in accounts.items()),
        start.isoformat(), end.isoformat(), owner_id, category, outcome, q], ensure_ascii=True).encode()).hexdigest()
    snapshot, after = utc_timestamp(), None
    if cursor:
        saved = unpack(cursor)
        if saved.get("scope") != scope:
            raise HTTPException(409, "Phạm vi lịch sử đã đổi. Hãy tải lại từ đầu.")
        try:
            snapshot = utc_timestamp(saved["as_of"])
            after = saved["after"]
            if not isinstance(after, list) or len(after) != 3 or not all(isinstance(v, str) for v in after):
                raise ValueError()
        except (KeyError, TypeError, ValueError):
            raise HTTPException(400, "Mã phân trang không hợp lệ") from None
    rows, position, deadline, names = [], None, clock.monotonic() + MAX_SECONDS, {}
    needle = normalized(q.strip())

    def resolve(row, event):
        if event["target_name"] is not None:
            return
        if clock.monotonic() > deadline:
            raise HTTPException(413, "Lịch sử vượt giới hạn thời gian đọc trực tiếp. Hãy thử lại sau.")
        key = (row["owner_id"], row["file_id"])
        if key not in names:
            target_name(metadata, row, event)
            names[key] = event["target_name"]
        else:
            event["target_name"] = names[key]

    for _ in range(MAX_PAGES):
        if clock.monotonic() > deadline:
            raise HTTPException(413, "Lịch sử vượt giới hạn thời gian đọc trực tiếp. Hãy thử lại sau.")
        params = {"TableName": audit.table_name, "Limit": 100, "ConsistentRead": True,
            "FilterExpression": "occurred_at >= :lower AND occurred_at < :upper AND occurred_at <= :snapshot",
            "ExpressionAttributeValues": serialize_item({":lower": lower, ":upper": upper, ":snapshot": snapshot})}
        if position:
            params["ExclusiveStartKey"] = position
        page = call_dynamodb(audit.client, "scan", **params)
        for raw in page.get("Items", []):
            if clock.monotonic() > deadline:
                raise HTTPException(413, "Lịch sử vượt giới hạn thời gian đọc trực tiếp. Hãy thử lại sau.")
            row = deserialize_item(raw)
            if not allowed(row, accounts, actor_id, owner_id):
                continue
            event = project(row, accounts, actor_id)
            if (category != "all" and event["category"] != category) or (outcome != "all" and event["outcome"] != outcome):
                continue
            # Resolve file metadata only for a name search or the selected page;
            # a routine page should not require one GetItem per historic file.
            search = " ".join(str(event.get(k) or "") for k in
                ("owner_id", "owner_name", "owner_email", "target_id", "target_name", "action_label", "actor_name"))
            if needle not in normalized(search):
                resolve(row, event)
                if needle not in normalized(event["target_name"]):
                    continue
            locator = {k: row[k] for k in ("owner_id", "file_id", "event_key", "occurred_at")}
            locator["details"] = {"folder_name": text((row.get("details") or {}).get("folder_name"), 120)}
            rows.append((locator, event))
        position = page.get("LastEvaluatedKey")
        if not position:
            break
    else:
        position = True
    if position:
        raise HTTPException(413, "Lịch sử vượt giới hạn đọc trực tiếp. Cần cấu hình chỉ mục audit theo thời gian trước khi tra cứu lượng dữ liệu lớn.")
    key = lambda entry: (entry[0]["occurred_at"], entry[0]["event_key"], entry[0]["file_id"])
    rows.sort(key=key, reverse=True)
    total = len(rows)
    pending = [entry for entry in rows if after is None or key(entry) < tuple(after)]
    selected = pending[:limit]
    for row, event in selected:
        resolve(row, event)
    next_cursor = pack({"scope": scope, "as_of": snapshot, "after": key(selected[-1])}) if len(pending) > limit else None
    return {"items": [event for _, event in selected], "total": total, "next_cursor": next_cursor,
            "as_of": snapshot, "timezone": "Asia/Ho_Chi_Minh"}


def get_history(audit, metadata, accounts, actor_id, ident):
    key = unpack(ident)
    if set(key) != {"file_id", "event_key"} or not all(isinstance(v, str) and 0 < len(v) <= 300 for v in key.values()):
        raise HTTPException(400, "Mã sự kiện không hợp lệ")
    result = call_dynamodb(audit.client, "get_item", TableName=audit.table_name, Key=serialize_item(key), ConsistentRead=True)
    row = deserialize_item(result["Item"]) if result.get("Item") else None
    if not row or not allowed(row, accounts, actor_id):
        raise HTTPException(404, "Không tìm thấy sự kiện trong phạm vi quản trị")
    event = project(row, accounts, actor_id)
    target_name(metadata, row, event)
    return detail(row, event)

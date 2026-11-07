"""Bounded, server-side reports; no raw detection values or extracted document text."""
from collections import Counter
from datetime import date, datetime, time, timedelta, timezone
import time as clock

from fastapi import HTTPException

from ..db import utc_timestamp
from .lifecycle import state as lifecycle_state
from ..routers.files import public_file, scan_report

VN = timezone(timedelta(hours=7))
STATUS_LABELS = {"not_started": "Chưa bắt đầu", "scanning": "Đang quét", "safe": "Không phát hiện",
                 "flagged": "Chờ cách ly", "quarantined": "Đã cách ly", "quarantine_delete_failed": "Cách ly lỗi",
                 "error": "Quét lỗi", "unscanned": "Chưa thể quét", "restored": "Đã khôi phục"}
METHODS = {"direct_text": "Đọc văn bản", "pdf_text": "PDF có lớp chữ", "textract_image": "OCR ảnh", "textract_pdf": "OCR PDF"}


def build_report(metadata, accounts, start, end, owner_id=None, lifecycle="all"):
    if start > end or (end - start).days > 365 or end == date.max:
        raise HTTPException(400, "Chọn khoảng thời gian hợp lệ, tối đa 366 ngày")
    if owner_id and owner_id not in accounts:
        raise HTTPException(404, "Tài khoản không thuộc hệ thống")
    owners = [owner_id] if owner_id else sorted(accounts)
    lower = datetime.combine(start, time.min, VN)
    upper = datetime.combine(end + timedelta(days=1), time.min, VN)
    counts, detections, methods = Counter(), {}, {}
    days = {(start + timedelta(days=i)).isoformat(): {"files": 0, "detected": 0, "errors": 0}
            for i in range((end - start).days + 1)}
    users = []
    total_bytes = unknown_counts = 0
    queries = 0
    deadline = clock.monotonic() + 20
    for owner in owners:
        row = {"id": owner, "name": accounts[owner]["name"], "files": 0, "bytes": 0,
               "detected": 0, "errors": 0, "findings": 0}
        cursor = None
        while True:
            queries += 1
            if queries > 200 or clock.monotonic() > deadline:
                raise HTTPException(413, "Phạm vi quá lớn để tổng hợp trực tiếp. Chọn một tài khoản để tiếp tục.")
            page = metadata.list_files(owner, limit=100, start_key=cursor)
            for item in page.items:
                if item.get("upload_state") != "uploaded" or (lifecycle != "all" and lifecycle_state(item) != lifecycle):
                    continue
                view = public_file(item, owner)
                try:
                    created = datetime.fromisoformat(view.created_at.replace("Z", "+00:00"))
                    if created.tzinfo is None:
                        raise ValueError()
                except (ValueError, TypeError):
                    raise HTTPException(503, "Có tệp thiếu ngày tải lên hợp lệ; chưa thể xác nhận báo cáo") from None
                if not lower <= created < upper:
                    continue
                report = scan_report(item, view)
                counts[view.scan_status] += 1
                detected = int(view.findings_count > 0)
                error = int(view.scan_status in {"error", "quarantine_delete_failed"})
                bucket = days[created.astimezone(VN).date().isoformat()]
                bucket["files"] += 1
                bucket["detected"] += detected
                bucket["errors"] += error
                row["files"] += 1
                row["bytes"] += view.size_bytes
                row["detected"] += detected
                row["errors"] += error
                row["findings"] += view.findings_count
                total_bytes += view.size_bytes
                if not report.counts_complete and view.findings_count:
                    unknown_counts += 1
                for finding in report.finding_counts if report.counts_complete else []:
                    entry = detections.setdefault(finding.type, {"type": finding.type, "count": 0, "files": 0})
                    entry["count"] += finding.count
                    entry["files"] += int(finding.count > 0)
                if report.extraction_method and report.extraction_duration_ms is not None:
                    entry = methods.setdefault(report.extraction_method, {"method": report.extraction_method, "files": 0, "total_ms": 0})
                    entry["files"] += 1
                    entry["total_ms"] += report.extraction_duration_ms
            cursor = page.next_key
            if not cursor:
                break
        users.append(row)
    total_files = sum(counts.values())
    extraction_files = sum(m["files"] for m in methods.values())
    return {"generated_at": utc_timestamp(), "filters": {"from": start.isoformat(), "to": end.isoformat(),
            "owner_id": owner_id, "lifecycle": lifecycle, "timezone": "Asia/Ho_Chi_Minh"},
            "scope_note": "Tệp của người dùng đã tải lên còn trong hệ thống, kể cả Thùng rác khi chọn tất cả. Nhóm theo ngày tải lên (UTC+7), dùng kết quả quét mới nhất; không phải lịch sử mọi lần quét. Thời gian chỉ tính bước trích xuất.",
            "totals": {"files": total_files, "bytes": total_bytes, "detected": sum(u["detected"] for u in users),
                       "errors": sum(u["errors"] for u in users), "findings": sum(u["findings"] for u in users),
                       "unknown_finding_files": unknown_counts, "extraction_files": extraction_files,
                       "extraction_average_ms": round(sum(m["total_ms"] for m in methods.values()) / extraction_files) if extraction_files else None},
            "statuses": [{"status": s, "label": label, "files": counts[s]} for s, label in STATUS_LABELS.items()],
            "trend": [{"date": day, **value} for day, value in days.items()],
            "detections": sorted(detections.values(), key=lambda r: (-r["count"], r["type"])),
            "users": sorted(users, key=lambda u: (-u["files"], u["id"])),
            "methods": [{**m, "label": METHODS[m["method"]], "average_ms": round(m["total_ms"] / m["files"])} for m in methods.values()],
            "owners": [{"id": k, "name": accounts[k]["name"]} for k in sorted(accounts)]}

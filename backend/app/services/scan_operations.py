"""Admin scan actions. File changes, audit and owner notices commit together."""

from uuid import uuid4

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException

from ..db import DynamoDBError, call_dynamodb, file_key, serialize_item, utc_timestamp
from .lifecycle import notification_put

SIZE_REASONS = {"file_too_large", "image_too_large"}
RETRY_REASONS = {"scan_failed", "scan_crashed", "ocr_failed", "ocr_timeout",
                 "rescan_start_failed", "execution_failed", "execution_result_missing"}


def compression_pending(item):
    return bool(item.get("compression_requested_at") and not item.get("compression_resolved_at"))


def operations_for(item):
    if item.get("lifecycle_state", "active") != "active" or item.get("upload_state") != "uploaded":
        return []
    if item.get("pipeline_busy"):
        return []
    status, reason = item.get("status"), item.get("status_reason") or item.get("reason")
    actions = ["withdraw_compression"] if compression_pending(item) else []
    if status == "scanning":
        if (item.get("scan_request_id") and item.get("rescan_actor") not in {None, "fastapi"}
                and item.get("rescan_dispatch") in {"pending", "unknown"}):
            return actions + ["check", "retry"]
        return actions + ["check"]
    if status == "unscanned" and reason in SIZE_REASONS:
        return actions if item.get("compression_requested_at") else ["request_compression"]
    if status in {"error", "unscanned"} and reason in RETRY_REASONS:
        return actions + ["retry"]
    return actions


def commit_operation(metadata, audit, item, actor, action, update, condition, values, notice=None):
    owner, ident, timestamp = item["owner_id"], item["file_id"], values[":at"]
    event = str(uuid4())
    changes = [
            {"Update": {
                "TableName": metadata.table_name,
                "Key": serialize_item(file_key(owner, ident)),
                "UpdateExpression": update,
                "ConditionExpression": ("#status = :previous AND upload_state = :uploaded AND "
                                        "(attribute_not_exists(lifecycle_state) OR lifecycle_state = :active)"
                                        + condition),
                "ExpressionAttributeNames": {"#status": "status"},
                "ExpressionAttributeValues": serialize_item({
                    ":previous": item["status"], ":uploaded": "uploaded", ":active": "active", **values,
                }),
            }},
            audit.event_put(owner, ident, event, action, actor, timestamp, {}),
    ]
    if notice:
        changes.append(notification_put(
            metadata, owner, ident, event, timestamp, f"admin-scan-{action.removeprefix('admin_scan_')}", *notice,
        ))
    try:
        call_dynamodb(metadata.client, "transact_write_items", TransactItems=changes)
    except DynamoDBError as exc:
        if exc.code == "TransactionCanceledException":
            raise HTTPException(409, "Tệp đã thay đổi. Hãy làm mới trạng thái.") from None
        raise


def request_compression(metadata, audit, item, actor):
    if item.get("compression_requested_at"):
        return "Đã gửi yêu cầu nén tệp cho chủ sở hữu."
    if "request_compression" not in operations_for(item):
        raise HTTPException(409, "Yêu cầu nén chỉ áp dụng cho tệp vượt giới hạn quét")
    name = item.get("display_name") or item["original_name"]
    commit_operation(
        metadata, audit, item, actor, "admin_scan_compression_requested", "SET compression_requested_at = :at",
        " AND attribute_not_exists(compression_requested_at) AND updated_at = :updated",
        {":at": utc_timestamp(), ":updated": item["updated_at"]},
        ("Yêu cầu nén lại tệp", f"{name} vượt giới hạn quét. Hãy nén tệp rồi tải lại.", "warning"),
    )
    return "Đã gửi yêu cầu nén tệp cho chủ sở hữu."


def resolve_compression(metadata, audit, item, actor, *, withdrawn=False):
    resolution = "withdrawn" if withdrawn else "completed"
    if item.get("compression_resolution") == resolution:
        return
    if not compression_pending(item):
        raise HTTPException(409, "Tệp không có yêu cầu nén đang chờ xử lý")
    name = item.get("display_name") or item["original_name"]
    commit_operation(
        metadata, audit, item, actor,
        "admin_scan_compression_withdrawn" if withdrawn else "compression_request_completed",
        "SET compression_resolved_at = :at, compression_resolution = :resolution",
        " AND compression_requested_at = :requested AND attribute_not_exists(compression_resolved_at)",
        {":at": utc_timestamp(), ":requested": item["compression_requested_at"], ":resolution": resolution},
        ("Đã thu hồi yêu cầu nén tệp", f"Quản trị viên đã thu hồi yêu cầu nén đối với {name}.", "info")
        if withdrawn else None,
    )


def check_execution(metadata, audit, item, actor, rescanner):
    if item.get("status") != "scanning":
        return "Đã cập nhật trạng thái từ máy chủ."
    execution = item.get("execution_id")
    if not execution:
        return "Chưa có mã lượt chạy. Hãy kiểm tra cấu hình nhận sự kiện tải lên."
    if rescanner is None or not execution.startswith(rescanner.arn.replace(":stateMachine:", ":execution:") + ":"):
        raise HTTPException(503, "Chưa cấu hình kiểm tra lượt quét cho workflow này")
    try:
        result = rescanner.client.describe_execution(executionArn=execution)
    except (BotoCoreError, ClientError):
        raise HTTPException(503, "Chưa xác minh được lượt quét trên AWS") from None
    if result.get("stateMachineArn") != rescanner.arn:
        raise HTTPException(409, "Lượt quét không thuộc workflow đã cấu hình")
    status = result.get("status")
    if status == "RUNNING":
        return "Lượt quét vẫn đang được AWS xử lý."
    if status == "PENDING_REDRIVE":
        return "Lượt quét đang chờ chạy lại trên AWS."
    if status not in {"FAILED", "TIMED_OUT", "ABORTED", "SUCCEEDED"}:
        raise HTTPException(503, "AWS chưa trả về trạng thái lượt quét đã biết")
    name = item.get("display_name") or item["original_name"]
    stamp = utc_timestamp()
    reason = "execution_result_missing" if status == "SUCCEEDED" else "execution_failed"
    commit_operation(
        metadata, audit, item, actor, "admin_scan_status_reconciled",
        "SET #status = :error, status_reason = :reason, updated_at = :at, status_time = :status_time",
        " AND execution_id = :execution",
        {":at": stamp, ":error": "error", ":reason": reason, ":execution": execution,
         ":status_time": f"{stamp}#{item['file_id']}"},
        ("Lượt quét cần xử lý lại", f"{name}. Lượt quét đã kết thúc mà chưa có kết quả trong MâySec.", "warning"),
    )
    return "Đã cập nhật kết quả đối chiếu và thông báo cho chủ sở hữu."

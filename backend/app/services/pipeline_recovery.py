"""Audited, version-pinned recovery of one pipeline step, never another OCR scan."""
import hashlib
import json
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..db import DynamoDBError, call_dynamodb, file_key, serialize_item, utc_timestamp
from .lifecycle import notification_put
from .quarantine_review import is_restored

TERMINAL = {"SUCCEEDED", "FAILED", "TIMED_OUT", "ABORTED"}
SETTLE_SECONDS = 960  # Synchronous Lambda may outlive an aborted/timed-out workflow.


class RecoveryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    action: Literal["check", "retry_quarantine", "retry_notification", "confirm_sent"]
    request_id: UUID
    revision: str = Field(min_length=64, max_length=64, pattern=r"^[a-f0-9]+$")
    channel: Literal["sns"] | None = None
    reason: str = Field(default="", max_length=300)
    receipt: str = Field(default="", max_length=160)
    evidence: str = Field(default="", max_length=300)
    allow_duplicate: bool = Field(default=False, strict=True)

    @model_validator(mode="after")
    def validate_decision(self):
        if self.action != "check" and len(self.reason) < 3:
            raise ValueError("Cần lý do xử lý")
        if (self.action in {"retry_notification", "confirm_sent"}) != (self.channel is not None):
            raise ValueError("Chọn đúng kênh thông báo")
        if self.action == "confirm_sent":
            if len(self.evidence) < 3:
                raise ValueError("Cần tham chiếu bằng chứng gửi")
            UUID(self.receipt)
        for value in (self.reason, self.receipt, self.evidence):
            if any(ord(c) < 32 for c in value):
                raise ValueError("Không dùng ký tự điều khiển")
        return self


def revision(item):
    fields = {k: v for k, v in item.items() if k.startswith(("notify_", "pipeline_")) or k in {
        "status", "upload_state", "lifecycle_state", "lifecycle_updated_at", "source_version_id",
        "execution_id", "quarantine_status", "quarantine_version_id", "quarantine_review"}}
    return hashlib.sha256(json.dumps(fields, sort_keys=True, default=str).encode()).hexdigest()


def recovery_view(item, *, configured=None):
    result = item.get("status")
    channels = []
    if result in {"safe", "quarantined"} and not is_restored(item):
        for channel in ("sns",):
            prefix = f"notify_{result}_{channel}"
            channels.append({"channel": channel, "state": item.get(prefix + "_state", "not_recorded"),
                "receipt": item.get(prefix + "_receipt"), "attempted_at": item.get(prefix + "_at"),
                "sent_at": item.get(prefix + "_sent_at"), "confirmed_by": item.get(prefix + "_confirmed_by"),
                "evidence": item.get(prefix + "_evidence")})
    job = item.get("pipeline_recovery")
    return {**({"configured": configured} if configured is not None else {}),
        "revision": revision(item), "busy": bool(item.get("pipeline_busy")),
        "quarantine_retryable": result in {"flagged", "quarantine_delete_failed"},
        "quarantine_step": item.get("quarantine_status"), "channels": channels,
        "job": {k: v for k, v in (job or {}).items() if k in {
            "action", "channel", "state", "requested_at", "checked_at", "actor", "reason"}} or None}


def needs_recovery(item):
    return (bool(item.get("pipeline_busy")) or item.get("status") in {"flagged", "quarantine_delete_failed"}
            or any(c["state"] in {"failed", "sending", "unknown"} for c in recovery_view(item)["channels"]))


def execution_info(runner, execution):
    if runner is None or not execution or not execution.startswith(runner.arn.replace(":stateMachine:", ":execution:") + ":"):
        raise HTTPException(503, "Chưa có workflow hoặc mã lượt chạy hợp lệ để xử lý riêng bước lỗi")
    try:
        result = runner.client.describe_execution(executionArn=execution)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ExecutionDoesNotExist":
            return None
        raise HTTPException(503, "Chưa xác minh được lượt xử lý trên AWS") from None
    except BotoCoreError:
        raise HTTPException(503, "Chưa xác minh được lượt xử lý trên AWS") from None
    if result.get("stateMachineArn") != runner.arn or result.get("executionArn", execution) != execution:
        raise HTTPException(409, "Lượt xử lý không khớp workflow đã cấu hình")
    return result


def require_stopped(runner, execution):
    info = execution_info(runner, execution)
    if info is None or info.get("status") not in TERMINAL:
        raise HTTPException(409, "Lượt xử lý còn chạy hoặc chưa rõ kết quả. Hãy kiểm tra lại trước.")
    if info["status"] != "SUCCEEDED":
        stop = info.get("stopDate")
        if not isinstance(stop, datetime) or stop.tzinfo is None:
            raise HTTPException(503, "AWS chưa xác nhận thời điểm dừng lượt xử lý")
        remaining = SETTLE_SECONDS - (datetime.now(timezone.utc) - stop).total_seconds()
        if remaining > 0:
            raise HTTPException(409, f"Chờ thêm {int(remaining) + 1} giây để bước Lambda cũ kết thúc trước khi xử lý lại.")
    return info


def commit(metadata, audit, item, fields, actor, event, details, *, notice=None, remove=()):
    # Compare all fields that affect execution, access, channel delivery or recovery.
    watched = {k for k in item if k.startswith(("notify_", "pipeline_"))}
    watched.update({"status", "upload_state", "lifecycle_state", "lifecycle_updated_at", "source_version_id",
                    "execution_id", "quarantine_status", "quarantine_version_id", "quarantine_review", "pipeline_busy", "pipeline_recovery"})
    watched.update(f"notify_{result}_{channel}_{suffix}" for result in ("safe", "quarantined")
        for channel in ("sns",) for suffix in ("state", "token", "receipt", "at", "sent_at", "confirmed_by", "evidence"))
    names, values, conditions, sets = {}, {}, ["attribute_exists(file_id)"], []
    for i, key in enumerate(sorted(watched)):
        name = f"#c{i}"
        names[name] = key
        if key in item:
            values[f":c{i}"] = item[key]
            conditions.append(f"{name} = :c{i}")
        else:
            conditions.append(f"attribute_not_exists({name})")
    for i, (key, value) in enumerate(fields.items()):
        names[f"#s{i}"] = key
        values[f":s{i}"] = value
        sets.append(f"#s{i} = :s{i}")
    update = "SET " + ", ".join(sets)
    if remove:
        for i, key in enumerate(remove):
            names[f"#r{i}"] = key
        update += " REMOVE " + ", ".join(f"#r{i}" for i in range(len(remove)))
    now = utc_timestamp()
    writes = [{"Update": {"TableName": metadata.table_name,
        "Key": serialize_item(file_key(item["owner_id"], item["file_id"])),
        "UpdateExpression": update, "ConditionExpression": " AND ".join(conditions),
        "ExpressionAttributeNames": names, "ExpressionAttributeValues": serialize_item(values)}},
        audit.event_put(item["owner_id"], item["file_id"], event[0], event[1], actor, now, details)]
    if notice:
        writes.append(notification_put(metadata, item["owner_id"], item["file_id"], event[0], now,
            "pipeline-recovery", *notice))
    try:
        call_dynamodb(metadata.client, "transact_write_items", TransactItems=writes)
    except DynamoDBError as exc:
        if exc.code == "TransactionCanceledException":
            raise HTTPException(409, "Tệp hoặc lượt gửi vừa thay đổi. Hãy cập nhật rồi đối chiếu lại.") from None
        raise
    return metadata.get_file(item["owner_id"], item["file_id"])


def recovery_payload(item, job):
    return {"recovery": {"request_id": job["request_id"], "action": job["action"], "channel": job.get("channel")},
        "detail": {"bucket": {"name": item["upload_bucket"]},
                   "object": {"key": item["key"], "version-id": item["source_version_id"]}},
        "scan": {"status": "flagged", "owner_id": item["owner_id"], "file_id": item["file_id"],
                 "source_version_id": item["source_version_id"]},
        "result": "quarantined" if job["action"] == "retry_quarantine" else item["status"],
        "key": item["key"], "owner_id": item["owner_id"], "file_id": item["file_id"],
        "source_version_id": item["source_version_id"]}


def retired_notification(job):
    return job.get("action") == "retry_notification" and job.get("channel") != "sns"


def dispatch(metadata, item, runner):
    job = item["pipeline_recovery"]
    if retired_notification(job):
        raise HTTPException(409, "Kênh thông báo cũ đã ngừng. Dùng Kiểm tra kết quả để kết thúc yêu cầu cũ.")
    if job["state"] not in {"pending", "unknown"}:
        return "Yêu cầu đã được ghi nhận. Chọn Kiểm tra kết quả để đối chiếu."
    if runner is None or not job["execution"].startswith(runner.arn.replace(":stateMachine:", ":execution:") + ":"):
        raise HTTPException(503, "Workflow đã đổi hoặc chưa sẵn sàng. Cần đối soát yêu cầu đang giữ.")
    # Reuse exactly the same name/input after an ambiguous StartExecution response.
    payload = json.dumps(recovery_payload(item, job), sort_keys=True, separators=(",", ":"))
    try:
        result = runner.client.start_execution(stateMachineArn=runner.arn,
            name=job["execution"].rsplit(":", 1)[-1], input=payload)
        if result.get("executionArn") != job["execution"]:
            raise HTTPException(503, "AWS chưa xác nhận đúng lượt xử lý. Hãy kiểm tra kết quả.")
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") != "ExecutionAlreadyExists":
            raise HTTPException(503, "Chưa xác nhận khởi chạy. Dùng Kiểm tra kết quả để xác nhận lại cùng yêu cầu.") from None
        existing = execution_info(runner, job["execution"])
        if not existing or existing.get("input") != payload:
            raise HTTPException(409, "Mã lượt xử lý đã được dùng với nội dung khác")
    except BotoCoreError:
        raise HTTPException(503, "Chưa rõ kết quả khởi chạy. Dùng Kiểm tra kết quả; không tạo yêu cầu mới.") from None
    # A late response must not overwrite a completed/reconciled job.
    call_dynamodb(metadata.client, "update_item", TableName=metadata.table_name,
        Key=serialize_item(file_key(item["owner_id"], item["file_id"])),
        UpdateExpression="SET pipeline_recovery.#state = :started",
        ConditionExpression="pipeline_recovery.request_id = :request AND pipeline_recovery.#state IN (:pending, :unknown)",
        ExpressionAttributeNames={"#state": "state"}, ExpressionAttributeValues=serialize_item({
            ":started": "started", ":pending": "pending", ":unknown": "unknown", ":request": job["request_id"]}))
    return "Đã gửi yêu cầu xử lý riêng bước lỗi. Chọn Kiểm tra kết quả để cập nhật."


def check(metadata, audit, item, actor, runner, *, allow_dispatch=True):
    job = item.get("pipeline_recovery")
    if not job or not item.get("pipeline_busy"):
        if runner is not None and item.get("execution_id"):
            info = execution_info(runner, item["execution_id"])
            if info:
                if item.get("status") == "flagged" and info.get("status") in TERMINAL:
                    # A stopped workflow cannot leave an unconfirmed quarantine
                    # labelled as queued. Do not infer whether copy/delete ran.
                    require_stopped(runner, item["execution_id"])
                    fields = quarantine_failure_fields(item)
                    if fields:
                        stamp = utc_timestamp()
                        commit(metadata, audit, item, {**fields, "updated_at": stamp,
                            "status_time": f"{stamp}#{item['file_id']}"}, actor,
                            ("quarantine-check-" + hashlib.sha256(item["execution_id"].encode()).hexdigest()[:48],
                             "admin_pipeline_checked"),
                            {"action": "check", "result": "failed", "execution_status": info["status"]},
                            notice=("Cách ly thất bại", item.get("display_name") or item["original_name"], "error"))
                    return "Lượt xử lý đã kết thúc nhưng cách ly chưa hoàn tất. Admin cần chọn Thử lại cách ly để chạy lại."
                labels = {"SUCCEEDED": "đã hoàn tất", "FAILED": "đã kết thúc với lỗi", "TIMED_OUT": "đã hết thời gian",
                          "ABORTED": "đã dừng", "RUNNING": "đang chạy", "PENDING_REDRIVE": "đang chờ chạy lại"}
                return (f"Lượt xử lý gần nhất {labels.get(info.get('status'), 'chưa rõ trạng thái')}. "
                        "Đã đọc lại bằng chứng SNS; lần gửi chưa rõ vẫn cần đối soát riêng.")
        return "Đã đọc lại trạng thái và bằng chứng gửi đang lưu trên máy chủ."
    info = execution_info(runner, job["execution"])
    if retired_notification(job):
        # Never dispatch an old notification job after the channel has been removed.
        if info is not None:
            if info.get("status") not in TERMINAL:
                return "Lượt xử lý kênh cũ vẫn đang chạy trên AWS. Chờ kết thúc rồi kiểm tra lại."
            require_stopped(runner, job["execution"])
        else:
            try:
                requested = datetime.fromisoformat(job["requested_at"].replace("Z", "+00:00"))
                if requested.tzinfo is None:
                    raise ValueError
            except (KeyError, TypeError, ValueError):
                raise HTTPException(503, "Chưa xác minh được thời điểm yêu cầu cũ; cần kiểm tra lượt chạy trên AWS.") from None
            if (datetime.now(timezone.utc) - requested).total_seconds() < SETTLE_SECONDS:
                raise HTTPException(409, "Chờ lượt xử lý cũ ổn định rồi kiểm tra lại; hệ thống không gửi lại kênh đã ngừng.")
        commit(metadata, audit, item, {"pipeline_busy": False,
            "pipeline_recovery": {**job, "state": "retired", "checked_at": utc_timestamp()}}, actor,
            (job["request_id"] + "-checked", "admin_pipeline_checked"),
            {"action": job["action"], "channel": job.get("channel"), "result": "retired",
             "execution_status": info["status"] if info else "NOT_FOUND"})
        return "Đã kết thúc yêu cầu của kênh đã ngừng, giữ nguyên lịch sử và bằng chứng cũ. Không gửi lại thông báo."
    if info is None:
        if job["state"] not in {"pending", "unknown"}:
            raise HTTPException(503, "AWS chưa trả lượt xử lý đã được xác nhận khởi chạy")
        if not allow_dispatch:
            raise HTTPException(503, "Pipeline đang tắt; chỉ đối chiếu, không khởi chạy yêu cầu đang giữ.")
        return dispatch(metadata, item, runner)
    if info.get("status") not in TERMINAL:
        return "Lượt xử lý vẫn đang chạy hoặc chờ chạy lại trên AWS."
    require_stopped(runner, job["execution"])
    channel = job.get("channel")
    confirmed = (item.get("status") == "quarantined" and item.get("quarantine_status") == "completed"
                 if job["action"] == "retry_quarantine" else
                 item.get(f"notify_{item['status']}_{channel}_state") == "sent")
    succeeded = info["status"] == "SUCCEEDED" and confirmed
    state = "succeeded" if succeeded else "failed"
    failure_fields = quarantine_failure_fields(item) if job["action"] == "retry_quarantine" and not succeeded else {}
    if failure_fields:
        stamp = utc_timestamp()
        failure_fields.update(updated_at=stamp, status_time=f"{stamp}#{item['file_id']}")
    commit(metadata, audit, item, {**failure_fields, "pipeline_busy": False,
        "pipeline_recovery": {**job, "state": state, "checked_at": utc_timestamp()}}, actor,
        (job["request_id"] + "-checked", "admin_pipeline_checked"),
        {"action": job["action"], "channel": channel, "execution_status": info["status"], "result": state},
        notice=("Đã xử lý lại bước cách ly" if succeeded else "Bước xử lý lại cần kiểm tra",
                item.get("display_name") or item["original_name"], "success" if succeeded else "warning")
        if job["action"] == "retry_quarantine" else None)
    return "Đã xác nhận xử lý thành công." if succeeded else "Lượt xử lý đã kết thúc; chưa xác nhận thành công. Xem trạng thái và lịch sử để xử lý tiếp."


def quarantine_failure_fields(item):
    if item.get("status") != "flagged" or item.get("quarantine_status") not in {None, "pending"}:
        return {}
    return {"quarantine_status": "failed", "quarantine_reason": "quarantine_failed",
            "status_reason": "quarantine_failed"}


def operate(metadata, audit, item, actor, runner, settings, payload):
    if (item.get("lifecycle_state", "active") != "active" or item.get("upload_state") != "uploaded"
            or item.get("storage") != "s3" or item.get("upload_bucket") != settings.s3_bucket_name):
        raise HTTPException(409, "Chỉ xử lý tệp S3 đã tải xong và đang hoạt động")
    if payload.action == "check":
        return check(metadata, audit, item, actor, runner, allow_dispatch=settings.scan_pipeline_enabled)
    signature = hashlib.sha256(payload.model_dump_json(exclude={"revision"}).encode()).hexdigest()
    previous = item.get("pipeline_recovery") or {}
    resolution = item.get("pipeline_resolution") or {}
    for record in (previous, resolution):
        if record.get("request_id") == str(payload.request_id):
            if record.get("signature") != signature or record.get("actor") != actor:
                raise HTTPException(409, "Mã yêu cầu đã được dùng cho thao tác khác")
            if record is previous:
                if not settings.scan_pipeline_enabled and record["state"] in {"pending", "unknown"}:
                    raise HTTPException(503, "Pipeline đang tắt; không khởi chạy lại yêu cầu đang giữ.")
                return dispatch(metadata, item, runner)
            return "Xác nhận gửi đã được lưu."
    if revision(item) != payload.revision or item.get("pipeline_busy"):
        raise HTTPException(409, "Tệp hoặc lượt xử lý đã đổi. Hãy cập nhật trước khi tiếp tục.")
    if is_restored(item):
        raise HTTPException(409, "Tệp đã được mở lại quyền tải; không xử lý lại thông báo cách ly cũ")
    if not settings.scan_pipeline_enabled or runner is None:
        raise HTTPException(503, "Chưa cấu hình workflow xử lý riêng bước lỗi")
    if not item.get("source_version_id") or item["source_version_id"] == "null":
        raise HTTPException(409, "Thiếu phiên bản nguồn để xử lý an toàn")
    require_stopped(runner, item.get("execution_id"))
    channel = payload.channel
    prefix = f"notify_{item['status']}_{channel}"
    delivery_state = item.get(prefix + "_state")
    if payload.action == "retry_quarantine":
        if item.get("status") not in {"flagged", "quarantine_delete_failed"}:
            raise HTTPException(409, "Tệp không ở trạng thái cần thử lại cách ly")
    elif item.get("status") not in {"safe", "quarantined"}:
        raise HTTPException(409, "Chỉ gửi thông báo cho kết quả không phát hiện hoặc đã cách ly")
    elif item["status"] == "quarantined" and item.get("quarantine_status") != "completed":
        raise HTTPException(409, "Chưa xác nhận cách ly hoàn tất")
    fields, remove = {}, ["pipeline_worker"]
    if payload.action == "retry_quarantine" and item.get("status") == "flagged":
        # Only an explicit admin request starts a new pending quarantine. Keep
        # scan findings/reason, but clear the previous quarantine failure label.
        stamp = utc_timestamp()
        fields.update(quarantine_status="pending", updated_at=stamp, status_time=f"{stamp}#{item['file_id']}")
        remove.extend(["quarantine_reason", "status_reason"])
    if payload.action == "confirm_sent":
        if delivery_state not in {"unknown", "sending"}:
            raise HTTPException(409, "Chỉ đối soát thủ công lần gửi chưa rõ kết quả")
        resolution = {"request_id": str(payload.request_id), "signature": signature, "actor": actor}
        commit(metadata, audit, item, {prefix + "_state": "sent", prefix + "_receipt": payload.receipt,
            prefix + "_sent_at": utc_timestamp(), prefix + "_confirmed_by": actor,
            prefix + "_evidence": payload.evidence, "pipeline_resolution": resolution}, actor,
            (str(payload.request_id), "admin_notification_confirmed"),
            {"channel": channel, "result": item["status"], "reason": payload.reason,
             "receipt": payload.receipt, "evidence": payload.evidence, "confirmation": "manual_attestation"})
        return "Đã lưu xác nhận theo bằng chứng của quản trị viên; đây không phải xác nhận người nhận đã đọc."
    if payload.action == "retry_notification":
        if delivery_state == "sent":
            raise HTTPException(409, "Kênh này đã xác nhận gửi; không gửi lại")
        if delivery_state not in {None, "failed", "sending", "unknown"}:
            raise HTTPException(409, "Trạng thái giao nhận chưa được hỗ trợ")
        if delivery_state in {"sending", "unknown"} and not payload.allow_duplicate:
            raise HTTPException(409, "Cần xác nhận nguy cơ gửi trùng khi chưa xác minh được lần gửi cũ")
        fields[prefix + "_state"] = "failed"
        remove.extend(prefix + tail for tail in ("_receipt", "_sent_at", "_confirmed_by", "_evidence"))
    try:
        machine = runner.client.describe_state_machine(stateMachineArn=runner.arn)
        definition = json.loads(machine.get("definition", "{}"))
    except (BotoCoreError, ClientError, ValueError):
        raise HTTPException(503, "Chưa xác minh được cấu hình workflow xử lý lại") from None
    if (machine.get("type") != "STANDARD" or definition.get("StartAt") != "RouteOperation"
            or not {"RecoveryQuarantine", "RecoveryNotify"}.issubset(definition.get("States", {}))):
        raise HTTPException(503, "Cần cập nhật workflow và Lambda theo phiên bản có hỗ trợ xử lý riêng bước lỗi")
    ident = str(payload.request_id)
    name = "recovery-" + hashlib.sha256(f"{item['owner_id']}|{item['file_id']}|{ident}".encode()).hexdigest()[:48]
    execution = runner.arn.replace(":stateMachine:", ":execution:") + ":" + name
    job = {"request_id": ident, "signature": signature, "actor": actor, "action": payload.action,
        "state": "pending", "requested_at": utc_timestamp(), "reason": payload.reason, "execution": execution}
    if channel:
        job["channel"] = channel
    item = commit(metadata, audit, item, {**fields, "pipeline_recovery": job, "pipeline_busy": True,
        "pipeline_request_id": ident, "execution_id": execution}, actor,
        (ident, "admin_pipeline_requested"), {"action": payload.action, "channel": channel,
         "reason": payload.reason, "allow_duplicate": payload.allow_duplicate,
         "previous_execution": item.get("execution_id"), "source_version_id": item["source_version_id"]}, remove=remove)
    return dispatch(metadata, item, runner)

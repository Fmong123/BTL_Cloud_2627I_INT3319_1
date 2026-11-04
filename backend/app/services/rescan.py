"""Start a new, version-pinned STANDARD workflow without replaying old results."""
from datetime import datetime, timezone
import hashlib
import json

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException

from ..db import DynamoDBConflict

ALLOWED_RESCAN = {"safe", "error", "unscanned", "not_started"}


class Rescanner:
    def __init__(self, client, state_machine_arn):
        self.client, self.arn = client, state_machine_arn

    def request(self, item, request_id, metadata, storage, audit):
        owner, file_id = item["owner_id"], item["file_id"]
        same_request = item.get("scan_request_id") == request_id
        if same_request and item.get("rescan_dispatch") in {"started", "failed"}:
            return
        try:
            machine = self.client.describe_state_machine(stateMachineArn=self.arn)
        except (BotoCoreError, ClientError):
            raise HTTPException(503, "Chưa xác minh được workflow quét lại") from None
        if machine.get("type") != "STANDARD":
            raise HTTPException(503, "Quét lại cần workflow STANDARD")
        if not same_request:
            if item.get("upload_state") != "uploaded" or item.get("status") not in ALLOWED_RESCAN:
                raise HTTPException(409, "Chỉ quét lại tệp đã tải xong, không đang xử lý hoặc cách ly")
            previous = item.get("rescan_requested_at")
            if previous and (datetime.now(timezone.utc) - datetime.fromisoformat(previous.replace("Z", "+00:00"))).total_seconds() < 60:
                raise HTTPException(429, "Hãy chờ 60 giây giữa hai yêu cầu quét lại", headers={"Retry-After": "60"})
            args = {"Bucket": item["upload_bucket"], "Key": item["key"]}
            if item.get("source_version_id"):
                args["VersionId"] = item["source_version_id"]
            try:
                head = storage.client.head_object(**args)
            except (BotoCoreError, ClientError):
                raise HTTPException(503, "Chưa xác minh được bản gốc để quét lại") from None
            version = head.get("VersionId")
            if not version or version == "null" or head.get("ContentLength") != item["size_bytes"] or (
                item.get("source_version_id") and version != item["source_version_id"]
            ):
                raise HTTPException(409, "Bản gốc cần có version hợp lệ và đúng dung lượng")
            digest = hashlib.sha256(f"{owner}|{file_id}|{request_id}".encode()).hexdigest()[:48]
            name = "rescan-" + digest
            execution = self.arn.replace(":stateMachine:", ":execution:") + ":" + name
            try:
                item = metadata.claim_rescan(owner, file_id, item, request_id=request_id,
                                             execution=execution, version=version)
            except DynamoDBConflict:
                raise HTTPException(409, "Trạng thái tệp đã đổi — hãy cập nhật trước khi quét lại") from None
        name = item["execution_id"].rsplit(":", 1)[-1]
        if item["execution_id"] != self.arn.replace(":stateMachine:", ":execution:") + ":" + name:
            raise HTTPException(503, "Workflow đã thay đổi — cần đối soát lượt quét trước đó")
        # Stable input and execution name make a retried dispatch idempotent.
        payload = {"detail": {"bucket": {"name": item["upload_bucket"]},
                              "object": {"key": item["key"], "version-id": item["source_version_id"]}}}
        audit.write_event(owner_id=owner, file_id=file_id, event_id=f"{file_id}:rescan:{request_id}",
                          occurred_at=item["rescan_requested_at"], action="rescan_requested", actor="fastapi",
                          execution_id=item["execution_id"],
                          details={"request_id": request_id, "source_version_id": item["source_version_id"]})
        try:
            result = self.client.start_execution(stateMachineArn=self.arn, name=name,
                                                 input=json.dumps(payload, separators=(",", ":"), sort_keys=True))
            if result.get("executionArn") != item["execution_id"]:
                metadata.set_rescan_dispatch(owner, file_id, request_id, "unknown")
                raise HTTPException(503, "Chưa xác nhận được đúng lượt quét — hãy kiểm tra lại")
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code != "ExecutionAlreadyExists":
                rejected = code in {"AccessDeniedException", "InvalidArn", "InvalidExecutionInput", "StateMachineDoesNotExist", "StateMachineDeleting", "ValidationException"}
                # Even a rejected retry cannot prove that an earlier ambiguous
                # dispatch did not start. Keep the same token and block content.
                metadata.set_rescan_dispatch(owner, file_id, request_id, "unknown")
                raise HTTPException(503, "Không khởi chạy được lượt quét" if rejected else "Chưa xác nhận được lượt quét — thử xác nhận lại cùng yêu cầu") from None
        except BotoCoreError:
            metadata.set_rescan_dispatch(owner, file_id, request_id, "unknown")
            raise HTTPException(503, "Chưa xác nhận được lượt quét — thử xác nhận lại cùng yêu cầu") from None
        metadata.set_rescan_dispatch(owner, file_id, request_id, "started")

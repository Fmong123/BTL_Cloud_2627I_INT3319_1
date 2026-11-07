"""Admin-only quarantine access for user accounts in the configured Cognito pool.

The regular /files routes remain owner-only. Every read of quarantine bytes is
audited before release; metadata, directory or audit failures never grant access.
"""
import base64
import binascii
import hashlib
import json
import logging
import unicodedata
from datetime import datetime, timezone
from pydantic import AwareDatetime, BaseModel
from typing import Literal
from uuid import UUID, uuid4

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response

from ..auth import require_admin
from ..db import DynamoDBError, utc_timestamp, file_key
from ..dependencies import get_settings, get_file_metadata, get_audit_log, get_storage, get_rescanner
from ..services.cognito_auth import AuthError, AuthUser
from ..services.admin_scope import user_scope, user_account
from ..services.storage import read_bounded, StorageTooLarge, StorageFailure
from .files import (owned_file, public_file, require_metadata, metadata_failure,
                    safe_filename, scan_report, history_response, content_key)
from ..services.lifecycle import state as lifecycle_state
from ..schemas.file import AdminFileDetail, AdminQuarantineResponse
from ..services.quarantine_review import (
    ReviewDecision, is_restored, quarantine_location, review_view, save_review, verify_restorable,
)
from ..services.scan_operations import operations_for, request_compression, resolve_compression, check_execution, compression_pending
from ..services.pipeline_recovery import RecoveryRequest, recovery_view, needs_recovery, operate

logger = logging.getLogger(__name__)
router = APIRouter()
STATUSES = {"quarantined", "quarantine_delete_failed", "flagged"}


class ScanOperation(BaseModel):
    action: Literal["check", "retry", "request_compression", "withdraw_compression"]
    request_id: UUID


def can_read_quarantine(item, settings):
    if (lifecycle_state(item) != "active" or item.get("upload_state") != "uploaded"
            or item.get("status") not in {"quarantined", "quarantine_delete_failed"} or is_restored(item)):
        return False
    try:
        quarantine_location(item, settings)
    except HTTPException:
        return False
    return type(item.get("size_bytes")) is int and 0 < item["size_bytes"] <= settings.max_file_size_bytes


def pool_accounts(request, *, fresh=False):
    directory = request.app.state.cognito_directory
    try:
        if directory is None:
            # Normal Cognito token verification still needs only public JWKS.
            # Administrative IAM credentials are consulted only on admin requests.
            import boto3
            from botocore.config import Config
            from ..services.demo_accounts import DemoAccounts
            settings = request.app.state.settings
            if not settings.cognito_user_pool_id:
                raise AuthError(503, "Chưa cấu hình Cognito cho quản trị")
            with boto3.client("cognito-idp", region_name=settings.cognito_user_pool_id.split("_")[0],
                              config=Config(connect_timeout=3, read_timeout=5, retries={"total_max_attempts": 2})) as client:
                directory = DemoAccounts(client, settings.cognito_user_pool_id)
                return {account["id"]: account for account in directory.accounts(fresh=fresh)}
        return {account["id"]: account for account in directory.accounts(fresh=fresh)}
    except AuthError as exc:
        raise HTTPException(exc.status_code, exc.message) from None
    except BotoCoreError:
        raise HTTPException(503, "Chưa kết nối danh sách Cognito để xác định phạm vi quản trị") from None


@router.get("/admin/quarantine", response_model=AdminQuarantineResponse)
def quarantine_list(request: Request, response: Response,
                    limit: int = Query(20, ge=1, le=100), cursor: str | None = Query(None, max_length=4096),
                    owner_id: UUID | None = Query(None), q: str = Query("", max_length=200),
                    status: Literal["all", "quarantined", "flagged", "quarantine_delete_failed"] = Query("all"),
                    updated_from: AwareDatetime | None = Query(None), updated_before: AwareDatetime | None = Query(None),
                    user: AuthUser = Depends(require_admin), settings=Depends(get_settings),
                    metadata=Depends(get_file_metadata)):
    response.headers["Cache-Control"] = "no-store"
    require_metadata(settings, metadata)
    accounts = pool_accounts(request, fresh=True)
    if updated_from and updated_before and updated_from >= updated_before:
        raise HTTPException(400, "Khoảng thời gian cập nhật không hợp lệ")
    if owner_id is not None:
        user_account(accounts, str(owner_id))
    accounts = user_scope(accounts)
    owners = [str(owner_id)] if owner_id else sorted(accounts)
    def normalized(value):
        return "".join(c for c in unicodedata.normalize("NFD", value.casefold().replace("đ", "d")) if not unicodedata.combining(c))
    search = normalized(q.strip())
    scope = hashlib.sha256(json.dumps([settings.cognito_user_pool_id, sorted(accounts), owners, status, search,
        updated_from.astimezone(timezone.utc).isoformat() if updated_from else None,
        updated_before.astimezone(timezone.utc).isoformat() if updated_before else None]).encode()).hexdigest()[:24]
    index, start = 0, None
    if cursor:
        try:
            data = json.loads(base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True))
            if not isinstance(data, dict) or set(data) != {"scope", "index", "start"} or data["scope"] != scope:
                raise ValueError()
            index, start = data["index"], data["start"]
            if type(index) is not int or not 0 <= index < len(owners):
                raise ValueError()
            if start is not None:
                if not isinstance(start, dict) or set(start) != {"owner_id", "file_id"} or start["owner_id"] != owners[index]:
                    raise ValueError()
                file_key(start["owner_id"], start["file_id"])
        except (ValueError, TypeError, KeyError, binascii.Error, UnicodeDecodeError):
            raise HTTPException(400, "Danh sách tài khoản đã đổi hoặc cursor không hợp lệ. Hãy tải lại.") from None
    items, queries = [], 0
    try:
        while index < len(owners) and len(items) < limit and queries < 10:
            owner = owners[index]
            page = metadata.list_files(owner, limit=max(1, limit - len(items)), start_key=start)
            queries += 1
            for item in page.items:
                if (item.get("status") in STATUSES and lifecycle_state(item) == "active" and not is_restored(item)
                        and (status == "all" or item.get("status") == status)
                        and search in normalized(item.get("display_name") or item.get("original_name", ""))):
                    view = public_file(item, owner)
                    if updated_from or updated_before:
                        try:
                            updated = datetime.fromisoformat(view.updated_at.replace("Z", "+00:00"))
                            if updated.tzinfo is None:
                                raise ValueError()
                        except (ValueError, TypeError):
                            raise HTTPException(503, "Thời gian cập nhật của tệp chưa đúng cấu trúc") from None
                        if (updated_from and updated < updated_from) or (updated_before and updated >= updated_before):
                            continue
                    items.append({**view.model_dump(), "owner_name": accounts[owner]["name"],
                                  "can_read": can_read_quarantine(item, settings)})
            start = page.next_key
            if start is None:
                index += 1
    except DynamoDBError as exc:
        raise metadata_failure(exc) from None
    next_cursor = base64.urlsafe_b64encode(json.dumps({"scope": scope, "index": index, "start": start}).encode()).decode().rstrip("=") if index < len(owners) else None
    return {"items": items, "next_cursor": next_cursor,
            "owners": [{"id": ident, "name": accounts[ident]["name"]} for ident in sorted(accounts)]}


@router.get("/admin/overview")
def security_overview(request: Request, response: Response, cursor: str | None = Query(None, max_length=4096),
                      user: AuthUser = Depends(require_admin), settings=Depends(get_settings),
                      metadata=Depends(get_file_metadata)):
    """Bounded aggregation pages, no Scan/index or client-provided totals."""
    response.headers["Cache-Control"] = "no-store"
    require_metadata(settings, metadata)
    accounts = user_scope(pool_accounts(request, fresh=True))
    owners = sorted(accounts)
    scope = hashlib.sha256(json.dumps(["overview", settings.cognito_user_pool_id, owners]).encode()).hexdigest()[:24]
    index, start = 0, None
    if cursor:
        try:
            data = json.loads(base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True))
            if not isinstance(data, dict) or set(data) != {"scope", "index", "start"} or data["scope"] != scope:
                raise ValueError()
            index, start = data["index"], data["start"]
            if type(index) is not int or not 0 <= index < len(owners):
                raise ValueError()
            if start is not None:
                if not isinstance(start, dict) or set(start) != {"owner_id", "file_id"} or start["owner_id"] != owners[index]:
                    raise ValueError()
                file_key(start["owner_id"], start["file_id"])
        except (ValueError, TypeError, KeyError, binascii.Error, UnicodeDecodeError):
            raise HTTPException(400, "Phạm vi thống kê đã đổi hoặc cursor không hợp lệ. Hãy tải lại.") from None
    counts = {status: 0 for status in ("not_started", "scanning", "safe", "flagged", "quarantined", "quarantine_delete_failed", "error", "unscanned", "restored")}
    queries = 0
    operations = []
    durations = {}
    now = datetime.now(timezone.utc)
    try:
        while index < len(owners) and queries < 10:
            page = metadata.list_files(owners[index], limit=100, start_key=start)
            queries += 1
            for item in page.items:
                if lifecycle_state(item) == "active" and item.get("upload_state") == "uploaded":
                    view = public_file(item, owners[index])
                    counts[view.scan_status] += 1
                    method, duration = item.get("extraction_method"), item.get("extraction_duration_ms")
                    if (method in ("direct_text", "pdf_text", "textract_image", "textract_pdf")
                            and type(duration) is int and duration >= 0):
                        bucket = durations.setdefault(method, {"count": 0, "total_ms": 0})
                        bucket["count"] += 1
                        bucket["total_ms"] += duration
                    review = review_view(item)
                    review_pending = bool(review and review["status"] in {"pending", "recommend_release"})
                    if (view.scan_status in {"scanning", "error", "unscanned", "quarantine_delete_failed"}
                            or review_pending or compression_pending(item) or needs_recovery(item)):
                        since = view.scan_started_at or view.rescan_requested_at or view.created_at
                        try:
                            age = max(0, int((now - datetime.fromisoformat(since.replace("Z", "+00:00"))).total_seconds()))
                        except (ValueError, TypeError):
                            age = None
                        operations.append({
                            "id": view.id, "owner_id": view.owner_id, "owner_name": accounts[view.owner_id]["name"],
                            "name": view.original_name, "status": view.scan_status, "reason": view.status_reason,
                            "execution_id": item.get("execution_id"), "scan_started_at": view.scan_started_at,
                            "age_seconds": age if view.scan_status == "scanning" else None,
                            "review_pending": review_pending,
                            "actions": operations_for(item),
                            "compression_requested": bool(item.get("compression_requested_at")),
                            "compression_resolution": item.get("compression_resolution"),
                            "pipeline_attention": needs_recovery(item),
                            "pipeline_busy": bool(item.get("pipeline_busy")),
                        })
            start = page.next_key
            if start is None:
                index += 1
    except DynamoDBError as exc:
        raise metadata_failure(exc) from None
    next_cursor = base64.urlsafe_b64encode(json.dumps({"scope": scope, "index": index, "start": start}).encode()).decode().rstrip("=") if index < len(owners) else None
    return {"users": len(owners), "counts": counts, "next_cursor": next_cursor,
            "operations": operations, "durations": durations}


def admin_file(request, owner_id, file_id, settings, metadata):
    require_metadata(settings, metadata)
    accounts = pool_accounts(request, fresh=True)
    owner = str(owner_id)
    user_account(accounts, owner)
    item, view = owned_file(metadata, owner, str(file_id))
    return item, view, accounts


@router.get("/admin/files/{file_id}", response_model=AdminFileDetail)
def file_detail(file_id: UUID, request: Request, response: Response, owner_id: UUID = Query(...),
                user: AuthUser = Depends(require_admin), settings=Depends(get_settings),
                metadata=Depends(get_file_metadata), rescanner=Depends(get_rescanner)):
    response.headers["Cache-Control"] = "no-store"
    item, view, accounts = admin_file(request, owner_id, file_id, settings, metadata)
    # Only schema-whitelisted metadata and aggregate findings; never raw text or quarantine locations.
    folder_path = None
    if item.get("folder_id"):
        from ..services.folders import Folders, path_names
        try:
            folder_path = path_names(Folders(metadata, str(owner_id)).rows, item["folder_id"])
        except DynamoDBError as exc:
            raise metadata_failure(exc) from None
    return {"file": view.model_dump(), "owner_name": accounts[str(owner_id)]["name"],
            "report": scan_report(item, view).model_dump(), "can_read": can_read_quarantine(item, settings),
            "quarantine_review": review_view(item), "folder_path": folder_path,
            "pipeline": recovery_view(item, configured=bool(settings.scan_pipeline_enabled and rescanner))}


@router.get("/admin/files/{file_id}/pipeline")
def pipeline_state(file_id: UUID, request: Request, response: Response, owner_id: UUID = Query(...),
                   user: AuthUser = Depends(require_admin), settings=Depends(get_settings),
                   metadata=Depends(get_file_metadata), rescanner=Depends(get_rescanner)):
    response.headers["Cache-Control"] = "no-store"
    item, _, _ = admin_file(request, owner_id, file_id, settings, metadata)
    return recovery_view(item, configured=bool(settings.scan_pipeline_enabled and rescanner))


@router.post("/admin/files/{file_id}/pipeline")
def pipeline_operation(file_id: UUID, payload: RecoveryRequest, request: Request, owner_id: UUID = Query(...),
                       user: AuthUser = Depends(require_admin), settings=Depends(get_settings),
                       metadata=Depends(get_file_metadata), audit=Depends(get_audit_log), rescanner=Depends(get_rescanner)):
    require_metadata(settings, metadata, audit, writing=True)
    item, _, _ = admin_file(request, owner_id, file_id, settings, metadata)
    try:
        message = operate(metadata, audit, item, user.owner_id, rescanner, settings, payload)
        return {"message": message, "pipeline": recovery_view(metadata.get_file(str(owner_id), str(file_id)),
            configured=bool(settings.scan_pipeline_enabled and rescanner))}
    except DynamoDBError as exc:
        raise metadata_failure(exc) from None


@router.post("/admin/files/{file_id}/quarantine-review")
def decide_review(file_id: UUID, payload: ReviewDecision, request: Request, owner_id: UUID = Query(...),
                  user: AuthUser = Depends(require_admin), settings=Depends(get_settings),
                  metadata=Depends(get_file_metadata), audit=Depends(get_audit_log), storage=Depends(get_storage)):
    item, _, _ = admin_file(request, owner_id, file_id, settings, metadata)
    require_metadata(settings, metadata, audit, writing=True)
    previous = review_view(item)
    expected = "restored" if payload.decision == "restore" else "keep_quarantine"
    if previous and previous["status"] == expected and previous.get("decision_reason") == payload.reason:
        return {"review": previous}
    if not previous or previous["status"] not in {"pending", "recommend_release"}:
        raise HTTPException(409, "Tệp không có yêu cầu đang chờ xử lý")
    if payload.decision == "restore":
        if not can_read_quarantine(item, settings):
            raise HTTPException(409, "Tệp chưa có bản cách ly có thể khôi phục")
        verify_restorable(item, settings, storage)
    try:
        return {"review": save_review(metadata, audit, item, user.owner_id, payload)}
    except DynamoDBError as exc:
        raise metadata_failure(exc) from None


@router.post("/admin/files/{file_id}/scan-operation")
def scan_operation(file_id: UUID, payload: ScanOperation, request: Request, owner_id: UUID = Query(...),
                   user: AuthUser = Depends(require_admin), settings=Depends(get_settings),
                   metadata=Depends(get_file_metadata), audit=Depends(get_audit_log),
                   storage=Depends(get_storage), rescanner=Depends(get_rescanner)):
    item, view, _ = admin_file(request, owner_id, file_id, settings, metadata)
    require_metadata(settings, metadata, audit, writing=True)
    if view.lifecycle_state != "active" or view.upload_state != "uploaded":
        raise HTTPException(409, "Tệp không còn ở trạng thái có thể xử lý")
    try:
        if payload.action == "request_compression":
            message = request_compression(metadata, audit, item, user.owner_id)
        elif payload.action == "withdraw_compression":
            resolve_compression(metadata, audit, item, user.owner_id, withdrawn=True)
            message = "Đã thu hồi yêu cầu nén tệp."
        elif payload.action == "check":
            message = check_execution(metadata, audit, item, user.owner_id, rescanner)
        else:
            request_id = str(payload.request_id)
            if "retry" not in operations_for(item) and item.get("scan_request_id") != request_id:
                raise HTTPException(409, "Trạng thái hiện tại không cho phép thử quét lại")
            if not settings.scan_pipeline_enabled or rescanner is None or view.storage != "s3":
                raise HTTPException(503, "Chưa cấu hình dịch vụ quét lại")
            content_key(item, view, str(owner_id), settings, storage)
            if item.get("status") == "scanning" and item.get("rescan_dispatch") in {"pending", "unknown"}:
                request_id = item["scan_request_id"]
            rescanner.request(item, request_id, metadata, storage, audit, admin_actor=user.owner_id)
            message = "Đã gửi yêu cầu quét lại."
    except DynamoDBError as exc:
        raise metadata_failure(exc) from None
    return {"message": message}


@router.get("/admin/files/{file_id}/history")
def file_history(file_id: UUID, request: Request, response: Response, owner_id: UUID = Query(...),
                 limit: int = Query(20, ge=1, le=100), cursor: str | None = Query(None, max_length=2048),
                 user: AuthUser = Depends(require_admin), settings=Depends(get_settings),
                 metadata=Depends(get_file_metadata), audit=Depends(get_audit_log)):
    response.headers["Cache-Control"] = "no-store"
    _, _, accounts = admin_file(request, owner_id, file_id, settings, metadata)
    require_metadata(settings, metadata, audit, writing=True)
    result = history_response(str(file_id), str(owner_id), audit, limit, cursor, admin_details=True)
    for event in result["items"]:
        actor = event.get("actor")
        event["actor_name"] = accounts.get(actor, {}).get("name") or {
            "fastapi": "Hệ thống API", "lambda": "Pipeline tự động",
            "lambda:securedrive-scan-pii": "Bộ quét tự động",
            "lambda:securedrive-quarantine-file": "Bộ cách ly tự động",
            "lambda:securedrive-notify": "Dịch vụ thông báo",
        }.get(actor, "Hệ thống")
    return result


@router.get("/admin/files/{file_id}/content")
def quarantine_content(file_id: UUID, request: Request, owner_id: UUID = Query(...),
                       user: AuthUser = Depends(require_admin), settings=Depends(get_settings),
                       metadata=Depends(get_file_metadata), audit=Depends(get_audit_log), storage=Depends(get_storage)):
    require_metadata(settings, metadata, audit, writing=True)
    owner, ident = str(owner_id), str(file_id)
    item, view, _ = admin_file(request, owner_id, file_id, settings, metadata)
    if (lifecycle_state(item) != "active" or item.get("upload_state") != "uploaded" or is_restored(item)
            or item.get("status") not in {"quarantined", "quarantine_delete_failed"}):
        raise HTTPException(409, "Tệp chưa có bản cách ly sẵn sàng để đọc")
    location = quarantine_location(item, settings)
    version = location["VersionId"]
    if type(item.get("size_bytes")) is not int or not 0 < item["size_bytes"] <= settings.max_file_size_bytes:
        raise HTTPException(413, "Tệp vượt giới hạn đọc nội dung")
    client = getattr(storage, "client", None)
    if client is None:
        raise HTTPException(503, "Chưa cấu hình kết nối S3")
    event_id = str(uuid4())

    def record(action, details):
        try:
            audit.write_event(owner_id=owner, file_id=ident, event_id=f"{event_id}:{action}",
                              occurred_at=utc_timestamp(), action=action, actor=user.owner_id,
                              details={"target_owner_id": owner, **details})
        except DynamoDBError as exc:
            raise metadata_failure(exc) from None

    record("admin_quarantine_read_started", {"quarantine_version_id": version})
    body = None
    try:
        result = client.get_object(**location)
        body = result.get("Body")
        if body is None or result.get("ContentLength") != item["size_bytes"]:
            raise StorageFailure("Quarantine object does not match metadata")
        data = read_bounded(body, settings.max_file_size_bytes)
        if len(data) != item["size_bytes"]:
            raise StorageFailure("Quarantine size mismatch")
    except StorageTooLarge:
        record("admin_quarantine_read_failed", {"reason": "size_limit"})
        raise HTTPException(413, "Bản cách ly vượt giới hạn đọc") from None
    except (BotoCoreError, ClientError, StorageFailure, OSError) as exc:
        code = exc.response.get("Error", {}).get("Code", "ClientError") if isinstance(exc, ClientError) else type(exc).__name__
        logger.warning("Admin quarantine read failed (%s), file_id=%s", code, ident)
        record("admin_quarantine_read_failed", {"reason": "storage_read_failed"})
        raise HTTPException(502, "Không đọc được bản cách ly. Kiểm tra quyền S3/KMS của backend.") from None
    finally:
        if body is not None:
            body.close()
    record("admin_quarantine_read_completed", {"size_bytes": len(data)})
    return Response(data, media_type="application/octet-stream", headers={
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        "Content-Disposition": f'attachment; filename="{safe_filename(view.original_name)}"',
    })

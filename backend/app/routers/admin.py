"""Admin-only quarantine access for identities in the configured Cognito pool.

The regular /files routes remain owner-only. Every read of quarantine bytes is
audited before release; metadata, directory or audit failures never grant access.
"""
import base64
import binascii
import hashlib
import json
import logging
from uuid import UUID, uuid4

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response

from ..auth import require_admin
from ..db import DynamoDBError, utc_timestamp, file_key
from ..dependencies import get_settings, get_file_metadata, get_audit_log, get_storage
from ..services.cognito_auth import AuthError, AuthUser
from ..services.storage import read_bounded, StorageTooLarge, StorageFailure
from .files import owned_file, public_file, require_metadata, metadata_failure, safe_filename
from ..services.lifecycle import state as lifecycle_state

logger = logging.getLogger(__name__)
router = APIRouter()
STATUSES = {"quarantined", "quarantine_delete_failed", "flagged"}


def pool_accounts(request):
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
                return {account["id"]: account for account in directory.accounts()}
        return {account["id"]: account for account in directory.accounts()}
    except AuthError as exc:
        raise HTTPException(exc.status_code, exc.message) from None
    except BotoCoreError:
        raise HTTPException(503, "Chưa kết nối danh sách Cognito để xác định phạm vi quản trị") from None


@router.get("/admin/quarantine")
def quarantine_list(request: Request, response: Response,
                    limit: int = Query(20, ge=1, le=100), cursor: str | None = Query(None, max_length=4096),
                    user: AuthUser = Depends(require_admin), settings=Depends(get_settings),
                    metadata=Depends(get_file_metadata)):
    response.headers["Cache-Control"] = "no-store"
    require_metadata(settings, metadata)
    accounts = pool_accounts(request)
    owners = sorted(accounts)
    scope = hashlib.sha256((settings.cognito_user_pool_id + ",".join(owners)).encode()).hexdigest()[:24]
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
                if item.get("status") in STATUSES and lifecycle_state(item) == "active":
                    view = public_file(item, owner)
                    items.append({**view.model_dump(), "owner_name": accounts[owner]["name"],
                                  "can_read": item.get("status") in {"quarantined", "quarantine_delete_failed"}
                                  and bool(item.get("quarantine_key")) and bool(item.get("quarantine_version_id"))
                                  and item.get("quarantine_bucket") == settings.quarantine_bucket_name})
            start = page.next_key
            if start is None:
                index += 1
    except DynamoDBError as exc:
        raise metadata_failure(exc) from None
    next_cursor = base64.urlsafe_b64encode(json.dumps({"scope": scope, "index": index, "start": start}).encode()).decode().rstrip("=") if index < len(owners) else None
    return {"items": items, "next_cursor": next_cursor}


@router.get("/admin/files/{file_id}/content")
def quarantine_content(file_id: UUID, request: Request, owner_id: UUID = Query(...),
                       user: AuthUser = Depends(require_admin), settings=Depends(get_settings),
                       metadata=Depends(get_file_metadata), audit=Depends(get_audit_log), storage=Depends(get_storage)):
    require_metadata(settings, metadata, audit, writing=True)
    owner, ident = str(owner_id), str(file_id)
    if owner not in pool_accounts(request):
        raise HTTPException(404, "Tài khoản không thuộc User Pool của ứng dụng")
    item, view = owned_file(metadata, owner, ident)
    if lifecycle_state(item) != "active" or item.get("upload_state") != "uploaded" or item.get("status") not in {"quarantined", "quarantine_delete_failed"}:
        raise HTTPException(409, "Tệp chưa có bản cách ly sẵn sàng để đọc")
    bucket, key, version = item.get("quarantine_bucket"), item.get("quarantine_key"), item.get("quarantine_version_id")
    prefix = f"uploads/{owner}/{ident}/"
    source_key = item.get("key", "")
    expected_key = source_key + ".version-" + str(item.get("source_version_id", ""))
    if (not settings.quarantine_bucket_name or bucket != settings.quarantine_bucket_name or bucket == settings.s3_bucket_name
            or not isinstance(key, str) or not key.startswith(prefix) or key != expected_key
            or not item.get("source_version_id") or not source_key.startswith(prefix)
            or "/" in source_key[len(prefix):] or not version):
        raise HTTPException(503, "Vị trí hoặc version cách ly không khớp cấu hình")
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
        result = client.get_object(Bucket=bucket, Key=key, VersionId=version)
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

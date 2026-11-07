"""Account controls use Cognito identities, audited changes and quota upload leases."""
from contextlib import contextmanager
import hashlib
import json
import unicodedata
from uuid import UUID
from typing import Literal

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..auth import require_admin
from ..db import DynamoDBError, call_dynamodb, serialize_item, utc_timestamp
from ..services.cognito_auth import AuthError
from ..services.admin_scope import user_scope, user_account, require_user_account
from ..services.quota import quota_lock, quota_config, usage, lease_check, QuotaBusy
from ..services.lifecycle import notification_put

router = APIRouter(dependencies=[Depends(require_admin)])
# All role/state edits share one lease so two administrators cannot remove each other.
MANAGEMENT_OWNER = "00000000-0000-0000-0000-000000000000"


@contextmanager
def services(request):
    state = request.app.state
    if not all((state.file_metadata, state.user_profiles, state.audit_log, state.cognito_directory)):
        raise HTTPException(503, "Quản lý tài khoản cần kết nối Cognito, hồ sơ, metadata và nhật ký")
    try:
        yield state.file_metadata, state.user_profiles, state.audit_log, state.cognito_directory
    except QuotaBusy:
        raise HTTPException(409, "Tài khoản đang có thao tác khác. Hãy tải lại rồi thử lại.") from None
    except AuthError as exc:
        raise HTTPException(exc.status_code, exc.message) from None
    except DynamoDBError:
        raise HTTPException(503, "Chưa xác nhận được thay đổi. Hãy tải lại để đối chiếu trạng thái và nhật ký.") from None
    except (ClientError, BotoCoreError):
        raise HTTPException(503, "Chưa xác nhận được thay đổi Cognito. Tải lại rồi chọn Tiếp tục đồng bộ.") from None


def account(directory, ident):
    return user_account({a["id"]: a for a in directory.accounts(fresh=True)}, ident)


def view(metadata, profiles, item):
    profile = profiles.get(item["id"])
    config = quota_config(metadata, item["id"])
    return {**item, "quota": usage(metadata, item["id"], config=config),
            "quota_revision": config.get("revision", 0),
            "revision": profile.get("management_revision", 0),
            "pending": profile.get("management_pending"),
            "last_login_at": profile.get("last_login_at")}


def normalize(value):
    return "".join(c for c in unicodedata.normalize("NFD", value.casefold().replace("đ", "d"))
                   if not unicodedata.combining(c))


@router.get("/admin/accounts/suggestions")
def suggestions(request: Request, response: Response, q: str = Query("", max_length=200),
                limit: int = Query(8, ge=1, le=10)):
    response.headers["Cache-Control"] = "no-store"
    if not q.strip():
        return {"items": []}
    with services(request) as (_, _, _, directory):
        search = normalize(q.strip())
        items = sorted((item for item in directory.accounts(fresh=True)
                        if item["role"] == "user" and search in normalize(
                            f'{item["name"]} {item["email"]} {item["username"]} {item["id"]}')),
                       key=lambda item: (normalize(item["name"]), item["id"]))
        return {"items": [{key: item[key] for key in ("id", "name", "email", "username")} for item in items[:limit]]}


@router.get("/admin/accounts")
def accounts(request: Request, response: Response, q: str = Query("", max_length=200),
             role: Literal["all", "user", "admin", "unassigned"] = "all",
             state: Literal["all", "active", "inactive"] = "all",
             owner_id: UUID | None = None,
             cursor: str | None = Query(None, max_length=100), limit: int = Query(10, ge=1, le=20)):
    response.headers["Cache-Control"] = "no-store"
    with services(request) as (metadata, profiles, _, directory):
        directory_items = {item["id"]: item for item in directory.accounts(fresh=True)}
        if owner_id is not None:
            user_account(directory_items, str(owner_id))
        items = list(user_scope(directory_items).values())
        filtered = sorted((a for a in items if
            (owner_id is None or a["id"] == str(owner_id)) and
            (role == "all" or (a["role"] or "unassigned") == role)
            and (state == "all" or a["active"] == (state == "active"))
            and normalize(q.strip()) in normalize(f'{a["name"]} {a["email"]} {a["username"]} {a["id"]}')),
            key=lambda a: a["id"])
        scope = hashlib.sha256(json.dumps([filtered, q, role, state], sort_keys=True).encode()).hexdigest()[:24]
        offset = 0
        if cursor:
            try:
                signature, number = cursor.split(":")
                offset = int(number)
                if signature != scope or not 0 <= offset < len(filtered):
                    raise ValueError()
            except ValueError:
                raise HTTPException(409, "Danh sách tài khoản đã đổi. Hãy tải lại từ đầu.") from None
        return {"items": [view(metadata, profiles, a) for a in filtered[offset:offset + limit]],
                "total": len(filtered), "accounts_total": len(items),
                "active_total": sum(a["active"] for a in items),
                "inactive_total": sum(not a["active"] for a in items),
                "next_cursor": f"{scope}:{offset + limit}" if offset + limit < len(filtered) else None}


class QuotaEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    limit_bytes: int = Field(ge=0, le=10_000_000_000_000, strict=True)
    revision: int = Field(ge=0, strict=True)
    request_id: UUID
    reason: str = Field(min_length=3, max_length=300)

    @field_validator("reason")
    @classmethod
    def meaningful_reason(cls, value):
        if len(value.strip()) < 3 or any(ord(c) < 32 and c not in "\n\t" for c in value):
            raise ValueError("Cần lý do thay đổi hợp lệ")
        return value.strip()


@router.patch("/admin/accounts/{owner_id}/quota")
def edit_quota(owner_id: UUID, payload: QuotaEdit, request: Request, user=Depends(require_admin)):
    owner = str(owner_id)
    with services(request) as (metadata, profiles, audit, directory):
        with quota_lock(metadata, owner) as lease:
            item = account(directory, owner)
            config = quota_config(metadata, owner)
            if config.get("request_id") == str(payload.request_id):
                if config.get("limit_bytes") != payload.limit_bytes or config.get("actor") != user.owner_id:
                    raise HTTPException(409, "Mã yêu cầu đã được dùng cho thay đổi khác")
                return view(metadata, profiles, item)
            if config.get("revision", 0) != payload.revision:
                raise HTTPException(409, "Quota đã thay đổi. Hãy tải lại trước khi chỉnh sửa.")
            current = usage(metadata, owner)
            minimum = current["used_bytes"] + current["reserved_bytes"]
            if payload.limit_bytes < minimum:
                raise HTTPException(409, f"Quota không được thấp hơn {minimum} byte đang dùng và đang giữ chỗ")
            now = utc_timestamp()
            record = {"owner_id": f"!quota!{owner}", "file_id": "settings", "limit_bytes": payload.limit_bytes,
                      "revision": payload.revision + 1, "request_id": str(payload.request_id),
                      "actor": user.owner_id, "updated_at": now}
            call_dynamodb(metadata.client, "transact_write_items", TransactItems=[
                lease_check(metadata, lease),
                {"Put": {"TableName": metadata.table_name, "Item": serialize_item(record)}},
                audit.event_put(owner, owner, str(payload.request_id), "account_quota_changed", user.owner_id, now,
                                {"before_bytes": current["limit_bytes"], "after_bytes": payload.limit_bytes,
                                 "reason": payload.reason.strip()}),
                notification_put(
                    metadata, owner, None, "quota-" + str(payload.request_id), now, "account-quota",
                    "Hạn mức dung lượng đã thay đổi",
                    f"Hạn mức mới: {payload.limit_bytes:,} byte. Lý do: {payload.reason.strip()}", "info",
                    destination="settings"),
            ])
        return view(metadata, profiles, item)


class AccessEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["user"]
    enabled: bool = Field(strict=True)
    revision: int = Field(ge=0, strict=True)
    request_id: UUID
    reason: str = Field(min_length=3, max_length=300)

    _reason = field_validator("reason")(QuotaEdit.meaningful_reason.__func__)


@router.patch("/admin/accounts/{owner_id}/access")
def edit_access(owner_id: UUID, payload: AccessEdit, request: Request, user=Depends(require_admin)):
    owner = str(owner_id)
    with services(request) as (metadata, profiles, audit, directory):
        with quota_lock(metadata, MANAGEMENT_OWNER, seconds=300) as lease:
            items = directory.accounts(fresh=True)
            actor = next((a for a in items if a["id"] == user.owner_id), None)
            actor_profile = profiles.get(user.owner_id)
            if (not actor or not actor["active"] or actor["role"] != "admin"
                    or actor_profile.get("management_pending") or actor_profile.get("access_disabled")
                    or actor_profile.get("managed_role", "admin") != "admin"):
                raise HTTPException(403, "Tài khoản hiện tại không còn quyền quản trị")
            target = next((a for a in items if a["id"] == owner), None)
            if not target:
                raise HTTPException(404, "Không tìm thấy tài khoản trong hệ thống")
            require_user_account(target)
            profile = profiles.get(owner)
            pending = profile.get("management_pending")
            desired = {"role": payload.role, "enabled": payload.enabled, "request_id": str(payload.request_id),
                       "actor": user.owner_id, "reason": payload.reason.strip(),
                       "before_role": pending.get("before_role") if pending else target["role"],
                       "before_enabled": pending.get("before_enabled") if pending else target["enabled"]}
            if profile.get("management_request_id") == str(payload.request_id) and not pending:
                if (profile.get("managed_role") != payload.role or profile.get("access_disabled") != (not payload.enabled)
                        or profile.get("management_actor") != user.owner_id):
                    raise HTTPException(409, "Mã yêu cầu đã được dùng cho thay đổi khác")
                return view(metadata, profiles, target)
            if pending and any(pending.get(k) != desired[k] for k in ("role", "enabled", "request_id")):
                raise HTTPException(409, "Có thay đổi chưa hoàn tất. Hãy tiếp tục đồng bộ yêu cầu đang chờ.")
            if not pending and profile.get("management_revision", 0) != payload.revision:
                raise HTTPException(409, "Tài khoản đã thay đổi. Hãy tải lại trước khi chỉnh sửa.")
            now = utc_timestamp()
            if not pending:
                call_dynamodb(metadata.client, "transact_write_items", TransactItems=[lease_check(metadata, lease),
                    {"Update": {"TableName": profiles.table, "Key": serialize_item({"user_id": owner}),
                        "UpdateExpression": "SET management_pending=:pending",
                        "ExpressionAttributeValues": serialize_item({":pending": desired})}},
                    audit.event_put(owner, owner, str(payload.request_id) + "-start", "account_access_requested",
                                    user.owner_id, now, {"before_role": target["role"] or "", "before_enabled": target["enabled"], **desired})])
            # Access is denied by managed_access until both providers confirm completion.
            args = {"UserPoolId": directory.pool_id, "Username": target["username"]}
            getattr(directory.client, "admin_enable_user" if payload.enabled else "admin_disable_user")(**args)
            target = account(directory, owner)
            if target["role"] != payload.role or target["enabled"] != payload.enabled:
                raise HTTPException(503, "Cognito chưa xác nhận trạng thái mới. Hãy tiếp tục đồng bộ.")
            call_dynamodb(metadata.client, "transact_write_items", TransactItems=[lease_check(metadata, lease),
                {"Update": {"TableName": profiles.table, "Key": serialize_item({"user_id": owner}),
                    "UpdateExpression": "SET managed_role=:role, access_disabled=:disabled, management_revision=:revision, management_request_id=:request, management_actor=:actor REMOVE management_pending",
                    "ExpressionAttributeValues": serialize_item({":role": payload.role, ":disabled": not payload.enabled,
                        ":revision": profile.get("management_revision", 0) + 1, ":request": str(payload.request_id), ":actor": user.owner_id})}},
                audit.event_put(owner, owner, str(payload.request_id), "account_access_changed", user.owner_id,
                                utc_timestamp(), {"role": payload.role, "enabled": payload.enabled,
                                    "before_role": desired["before_role"], "before_enabled": desired["before_enabled"],
                                    "reason": payload.reason.strip()})])
        return view(metadata, profiles, target)


@router.get("/admin/accounts/{owner_id}/history")
def history(owner_id: UUID, request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    with services(request) as (_, _, audit, directory):
        account(directory, str(owner_id))
        from ..db import deserialize_item
        result = call_dynamodb(audit.client, "query", TableName=audit.table_name,
                              KeyConditionExpression="file_id=:owner", ExpressionAttributeValues=serialize_item({":owner": str(owner_id)}),
                              ConsistentRead=True, ScanIndexForward=False, Limit=50)
        return {"items": [deserialize_item(row) for row in result.get("Items", [])],
                "note": "Tối đa 50 thay đổi gần nhất"}

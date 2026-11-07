"""Owned file management and durable user activity; no raw scan content."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from ..auth import get_current_user, require_admin
from ..services.notifications import ADMIN_OWNER, ADMIN_KIND, admin_visible, public_notice, acknowledge_admin

from .files import (
    require_metadata, owned_file, public_file, decode_cursor, encode_cursor, metadata_failure,
)
from ..db import DynamoDBError, file_key
from ..dependencies import get_settings, get_storage, get_file_metadata, get_current_owner_id, get_audit_log
from ..schemas.file import ErrorResponse, FileListResponse, FileListItem, RenameRequest, NotificationRequest
from ..services.lifecycle import FileLifecycle, LifecycleConflict, history_page, notification_page, save_notification
from ..services.storage import StorageFailure, StorageUnavailable
from ..services.quarantine_review import ReviewRequest, review_view, save_review
from ..services.scan_operations import resolve_compression

router = APIRouter(responses={
    401: {"model": ErrorResponse, "description": "Missing, invalid or expired access token"},
    403: {"model": ErrorResponse, "description": "Account has no permitted role"},
})


def run_change(action, file_id, payload, settings, storage, metadata, owner):
    require_metadata(settings, metadata)
    item, view = owned_file(metadata, owner, file_id)
    service = FileLifecycle(metadata, storage, settings)
    try:
        if action == "name":
            changed = service.rename(item, payload.name)
        elif action == "trash":
            changed = service.trash(item)
        elif action == "restore":
            changed = service.restore(item)
        else:
            return service.purge(item)
        return public_file(changed, owner)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    except LifecycleConflict as exc:
        raise HTTPException(409, str(exc)) from None
    except DynamoDBError as exc:
        raise metadata_failure(exc) from None
    except StorageUnavailable:
        raise HTTPException(503, "Chưa cấu hình đủ quyền hoặc vị trí lưu trữ để xóa tệp") from None
    except StorageFailure:
        raise HTTPException(502, "Chưa xóa hết nội dung tệp. Dung lượng vẫn được giữ; hãy thử xóa lại") from None


@router.patch("/files/{file_id}/name", response_model=FileListItem)
def rename_file(file_id: str, payload: RenameRequest,
    settings=Depends(get_settings), storage=Depends(get_storage),
    metadata=Depends(get_file_metadata), owner=Depends(get_current_owner_id)):
    return run_change("name", file_id, payload, settings, storage, metadata, owner)


@router.post("/files/{file_id}/trash", response_model=FileListItem)
def trash_file(file_id: str, settings=Depends(get_settings), storage=Depends(get_storage),
    metadata=Depends(get_file_metadata), owner=Depends(get_current_owner_id)):
    return run_change("trash", file_id, None, settings, storage, metadata, owner)


@router.post("/files/{file_id}/restore", response_model=FileListItem)
def restore_file(file_id: str, settings=Depends(get_settings), storage=Depends(get_storage),
    metadata=Depends(get_file_metadata), owner=Depends(get_current_owner_id)):
    return run_change("restore", file_id, None, settings, storage, metadata, owner)


@router.get("/files/{file_id}/quarantine-review")
def get_review(file_id: str, settings=Depends(get_settings), metadata=Depends(get_file_metadata),
               owner=Depends(get_current_owner_id)):
    require_metadata(settings, metadata)
    item, _ = owned_file(metadata, owner, file_id)
    return {"review": review_view(item)}


@router.post("/files/{file_id}/compression-request/complete", response_model=FileListItem)
def complete_compression_request(file_id: str, settings=Depends(get_settings),
                                 metadata=Depends(get_file_metadata), audit=Depends(get_audit_log),
                                 owner=Depends(get_current_owner_id)):
    require_metadata(settings, metadata, audit, writing=True)
    item, view = owned_file(metadata, owner, file_id)
    if view.lifecycle_state != "active":
        raise HTTPException(409, "Tệp không còn ở trạng thái có thể xử lý")
    try:
        resolve_compression(metadata, audit, item, owner)
        _, view = owned_file(metadata, owner, file_id)
    except DynamoDBError as exc:
        raise metadata_failure(exc) from None
    return view


@router.post("/files/{file_id}/quarantine-review")
def request_review(file_id: str, payload: ReviewRequest, settings=Depends(get_settings),
                   metadata=Depends(get_file_metadata), audit=Depends(get_audit_log),
                   owner=Depends(get_current_owner_id)):
    require_metadata(settings, metadata, audit, writing=True)
    item, _ = owned_file(metadata, owner, file_id)
    try:
        return {"review": save_review(metadata, audit, item, owner, payload)}
    except DynamoDBError as exc:
        raise metadata_failure(exc) from None


@router.delete("/files/{file_id}")
def purge_file(file_id: str, settings=Depends(get_settings), storage=Depends(get_storage),
    metadata=Depends(get_file_metadata), owner=Depends(get_current_owner_id)):
    # Repeating an acknowledged deletion is harmless; an archive is proof that
    # the bytes and the live metadata were both removed.
    require_metadata(settings, metadata)
    try:
        file_key(owner, file_id)
    except ValueError:
        raise HTTPException(400, "ID tệp không hợp lệ") from None
    try:
        if metadata.get_file(owner, file_id) is None:
            archive = metadata.get_file(f"!history!{owner}", file_id)
            if archive and archive.get("lifecycle_state") == "purged":
                return {"id": file_id, "deleted": True}
    except DynamoDBError as exc:
        raise metadata_failure(exc) from None
    return run_change("purge", file_id, None, settings, storage, metadata, owner)


@router.get("/upload-history", response_model=FileListResponse)
def upload_history(limit: int = Query(100, ge=1, le=100), cursor: str | None = Query(None, max_length=2048),
    settings=Depends(get_settings), metadata=Depends(get_file_metadata), owner=Depends(get_current_owner_id)):
    require_metadata(settings, metadata)
    partition = f"!history!{owner}"
    start = decode_cursor(cursor, partition)
    try:
        page = history_page(metadata, owner, limit=limit, start_key=start)
        return FileListResponse(items=[public_file(r, owner) for r in page.items], next_cursor=encode_cursor(page.next_key))
    except DynamoDBError as exc:
        raise metadata_failure(exc) from None


@router.get("/notifications")
def notifications(limit: int = Query(100, ge=1, le=100), cursor: str | None = Query(None, max_length=2048),
    *, request: Request, response: Response, settings=Depends(get_settings), metadata=Depends(get_file_metadata), user=Depends(get_current_user)):
    require_metadata(settings, metadata)
    response.headers["Cache-Control"] = "no-store"
    owner = user.owner_id
    start = decode_cursor(cursor, f"!notifications!{owner}")
    try:
        page = notification_page(metadata, owner, limit=limit, start_key=start)
        accounts = {}
        if user.role == "admin" and any(r.get("kind") == ADMIN_KIND or r.get("destination") == "admin/costs" for r in page.items):
            from .admin import pool_accounts
            accounts = pool_accounts(request, fresh=True)
        items = [public_notice(r) for r in page.items
                 if (r.get("kind") != ADMIN_KIND or admin_visible(r, accounts, owner))
                 and (r.get("destination") != "admin/costs" or
                      (accounts.get(owner, {}).get("role") == "admin" and accounts[owner].get("active")))]
        return {"items": items, "next_cursor": encode_cursor(page.next_key)}
    except DynamoDBError as exc:
        raise metadata_failure(exc) from None


@router.post("/notifications")
def persist_notification(payload: NotificationRequest, request: Request, settings=Depends(get_settings),
    metadata=Depends(get_file_metadata), user=Depends(get_current_user)):
    require_metadata(settings, metadata)
    try:
        if payload.kind == ADMIN_KIND:
            if user.role != "admin":
                raise HTTPException(403, "Thông báo này dành cho quản trị viên")
            from .admin import pool_accounts
            return acknowledge_admin(metadata, user.owner_id, payload, pool_accounts(request, fresh=True))
        existing = metadata.get_file(f"!notifications!{user.owner_id}", f"{payload.created_at}#{payload.id}")
        if existing and existing.get("destination") == "admin/costs":
            from .admin import pool_accounts
            actor = pool_accounts(request, fresh=True).get(user.owner_id, {})
            if user.role != "admin" or actor.get("role") != "admin" or not actor.get("active"):
                raise HTTPException(403, "Thông báo chi phí này dành cho quản trị viên")
        if payload.kind.startswith("billing-") and not existing:
            raise HTTPException(403, "Thông báo chi phí chỉ được tạo bởi máy chủ")
        if existing and existing.get("kind") == ADMIN_KIND:
            raise HTTPException(403, "Không được sửa thông báo quản trị")
        return save_notification(metadata, user.owner_id, payload.model_dump())
    except DynamoDBError as exc:
        raise metadata_failure(exc) from None


@router.get("/admin/notifications")
def admin_notifications(request: Request, response: Response,
    limit: int = Query(100, ge=1, le=100), cursor: str | None = Query(None, max_length=2048),
    settings=Depends(get_settings), metadata=Depends(get_file_metadata), user=Depends(require_admin)):
    require_metadata(settings, metadata)
    from .admin import pool_accounts
    accounts = pool_accounts(request, fresh=True)
    if accounts.get(user.owner_id, {}).get("role") != "admin" or not accounts[user.owner_id].get("active"):
        raise HTTPException(403, "Tài khoản hiện tại không còn quyền quản trị")
    response.headers["Cache-Control"] = "no-store"
    start = decode_cursor(cursor, f"!notifications!{ADMIN_OWNER}")
    try:
        page = notification_page(metadata, ADMIN_OWNER, limit=limit, start_key=start)
        return {"items": [public_notice(r) for r in page.items if admin_visible(r, accounts, user.owner_id)],
                "next_cursor": encode_cursor(page.next_key)}
    except DynamoDBError as exc:
        raise metadata_failure(exc) from None

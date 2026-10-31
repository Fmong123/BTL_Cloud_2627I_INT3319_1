"""Owned file management and durable user activity; no raw scan content."""
from fastapi import APIRouter, Depends, HTTPException, Query

from .files import (
    require_metadata, owned_file, public_file, decode_cursor, encode_cursor, metadata_failure,
)
from ..db import DynamoDBError, file_key
from ..dependencies import get_settings, get_storage, get_file_metadata, get_dev_owner_id
from ..schemas.file import FileListResponse, FileListItem, RenameRequest, NotificationRequest
from ..services.lifecycle import FileLifecycle, LifecycleConflict, history_page, notification_page, save_notification
from ..services.storage import StorageFailure, StorageUnavailable

router = APIRouter()


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
    metadata=Depends(get_file_metadata), owner=Depends(get_dev_owner_id)):
    return run_change("name", file_id, payload, settings, storage, metadata, owner)


@router.post("/files/{file_id}/trash", response_model=FileListItem)
def trash_file(file_id: str, settings=Depends(get_settings), storage=Depends(get_storage),
    metadata=Depends(get_file_metadata), owner=Depends(get_dev_owner_id)):
    return run_change("trash", file_id, None, settings, storage, metadata, owner)


@router.post("/files/{file_id}/restore", response_model=FileListItem)
def restore_file(file_id: str, settings=Depends(get_settings), storage=Depends(get_storage),
    metadata=Depends(get_file_metadata), owner=Depends(get_dev_owner_id)):
    return run_change("restore", file_id, None, settings, storage, metadata, owner)


@router.delete("/files/{file_id}")
def purge_file(file_id: str, settings=Depends(get_settings), storage=Depends(get_storage),
    metadata=Depends(get_file_metadata), owner=Depends(get_dev_owner_id)):
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
    settings=Depends(get_settings), metadata=Depends(get_file_metadata), owner=Depends(get_dev_owner_id)):
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
    settings=Depends(get_settings), metadata=Depends(get_file_metadata), owner=Depends(get_dev_owner_id)):
    require_metadata(settings, metadata)
    start = decode_cursor(cursor, f"!notifications!{owner}")
    try:
        page = notification_page(metadata, owner, limit=limit, start_key=start)
        items = [{k: v for k, v in r.items() if k not in {"owner_id", "file_id", "target_file_id"}}
                 | {"file_id": r.get("target_file_id"), "read": r.get("read", False)} for r in page.items]
        return {"items": items, "next_cursor": encode_cursor(page.next_key)}
    except DynamoDBError as exc:
        raise metadata_failure(exc) from None


@router.post("/notifications")
def persist_notification(payload: NotificationRequest, settings=Depends(get_settings),
    metadata=Depends(get_file_metadata), owner=Depends(get_dev_owner_id)):
    require_metadata(settings, metadata)
    try:
        return save_notification(metadata, owner, payload.model_dump())
    except DynamoDBError as exc:
        raise metadata_failure(exc) from None

"""Folder navigation, atomic moves and recoverable folder trash."""
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field
from ..db import DynamoDBError
from ..dependencies import get_current_owner_id, get_file_metadata, get_settings, get_audit_log, get_storage
from ..services.folders import Folders, folder_view
from ..services.lifecycle import LifecycleConflict
from ..services.storage import StorageFailure, StorageUnavailable
from .files import metadata_failure, require_metadata

router = APIRouter()


class FolderName(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=120)


class NewFolder(FolderName):
    parent_id: UUID | None = None


class MoveFolder(BaseModel):
    model_config = ConfigDict(extra="forbid")
    parent_id: UUID | None


class MoveFiles(BaseModel):
    model_config = ConfigDict(extra="forbid")
    folder_id: UUID | None
    file_ids: list[UUID] = Field(min_length=1, max_length=50)


def service(settings=Depends(get_settings), metadata=Depends(get_file_metadata),
            audit=Depends(get_audit_log), owner=Depends(get_current_owner_id)):
    require_metadata(settings, metadata, audit, writing=True)
    try:
        return Folders(metadata, owner, audit)
    except DynamoDBError as exc:
        raise metadata_failure(exc) from None


def execute(fn):
    try:
        return fn()
    except DynamoDBError as exc:
        raise metadata_failure(exc) from None
    except LifecycleConflict as exc:
        raise HTTPException(409, str(exc)) from None
    except StorageUnavailable:
        raise HTTPException(503, "Chưa đủ cấu hình/quyền xóa nội dung thư mục") from None
    except StorageFailure:
        raise HTTPException(502, "Một số nội dung chưa xóa xong. Thư mục vẫn ở Thùng rác; hãy thử lại.") from None


@router.get("/folders")
def list_folders(response: Response, folders=Depends(service)):
    response.headers["Cache-Control"] = "no-store"
    return {"items": [folder_view(r) for r in folders.rows.values()], "next_cursor": None}


@router.post("/folders", status_code=201)
def create_folder(payload: NewFolder, folders=Depends(service)):
    return execute(lambda: folders.create(payload.name, str(payload.parent_id) if payload.parent_id else None))


@router.patch("/folders/{folder_id}")
def rename_folder(folder_id: UUID, payload: FolderName, folders=Depends(service)):
    return execute(lambda: folders.rename(str(folder_id), payload.name))


@router.post("/folders/move-files")
def move_files(payload: MoveFiles, folders=Depends(service)):
    return execute(lambda: folders.move_files(list(map(str, payload.file_ids)), str(payload.folder_id) if payload.folder_id else None))


@router.post("/folders/{folder_id}/move")
def move_folder(folder_id: UUID, payload: MoveFolder, folders=Depends(service)):
    return execute(lambda: folders.move(str(folder_id), str(payload.parent_id) if payload.parent_id else None))


@router.post("/folders/{folder_id}/trash")
def trash_folder(folder_id: UUID, folders=Depends(service)):
    return execute(lambda: folders.trash(str(folder_id)))


@router.post("/folders/{folder_id}/restore")
def restore_folder(folder_id: UUID, folders=Depends(service)):
    return execute(lambda: folders.restore(str(folder_id)))


@router.delete("/folders/{folder_id}")
def purge_folder(folder_id: UUID, folders=Depends(service), storage=Depends(get_storage), settings=Depends(get_settings)):
    return execute(lambda: folders.purge(str(folder_id), storage, settings))

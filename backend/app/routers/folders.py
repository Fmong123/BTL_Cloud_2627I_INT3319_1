"""Owner-scoped virtual folders. Moving a file changes only its metadata."""

from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from ..db import DynamoDBConflict, DynamoDBError, call_dynamodb, file_key, serialize_item, utc_timestamp
from ..dependencies import get_current_owner_id, get_file_metadata, get_settings
from .files import decode_cursor, encode_cursor, metadata_failure, require_metadata

router = APIRouter()


class FolderName(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=120)


class MoveFiles(BaseModel):
    model_config = ConfigDict(extra="forbid")
    folder_id: UUID | None
    file_ids: list[UUID] = Field(min_length=1, max_length=50)


def folder_view(item):
    return {"id": item["file_id"], "name": item["name"]}


@router.get("/folders")
def list_folders(cursor: str | None = Query(None, max_length=2048), settings=Depends(get_settings),
                 metadata=Depends(get_file_metadata), owner=Depends(get_current_owner_id)):
    require_metadata(settings, metadata)
    partition = f"!folders!{owner}"
    try:
        page = metadata.list_files(partition, limit=100, start_key=decode_cursor(cursor, partition))
    except DynamoDBError as exc:
        raise metadata_failure(exc) from None
    return {"items": [folder_view(item) for item in page.items], "next_cursor": encode_cursor(page.next_key)}


@router.post("/folders", status_code=201)
def create_folder(payload: FolderName, settings=Depends(get_settings),
                  metadata=Depends(get_file_metadata), owner=Depends(get_current_owner_id)):
    require_metadata(settings, metadata)
    item = {**file_key(f"!folders!{owner}", str(uuid4())), "name": payload.name}
    try:
        call_dynamodb(metadata.client, "put_item", TableName=metadata.table_name,
                      Item=serialize_item(item), ConditionExpression="attribute_not_exists(file_id)")
    except DynamoDBError as exc:
        raise metadata_failure(exc) from None
    return folder_view(item)


@router.patch("/folders/{folder_id}")
def rename_folder(folder_id: UUID, payload: FolderName, settings=Depends(get_settings),
                  metadata=Depends(get_file_metadata), owner=Depends(get_current_owner_id)):
    require_metadata(settings, metadata)
    try:
        call_dynamodb(metadata.client, "update_item", TableName=metadata.table_name,
                      Key=serialize_item(file_key(f"!folders!{owner}", str(folder_id))),
                      ConditionExpression="attribute_exists(file_id)", UpdateExpression="SET #name = :name",
                      ExpressionAttributeNames={"#name": "name"},
                      ExpressionAttributeValues=serialize_item({":name": payload.name}))
    except DynamoDBConflict:
        raise HTTPException(404, "Không tìm thấy thư mục") from None
    except DynamoDBError as exc:
        raise metadata_failure(exc) from None
    return {"id": str(folder_id), "name": payload.name}


@router.post("/folders/move-files")
def move_files(payload: MoveFiles, settings=Depends(get_settings),
               metadata=Depends(get_file_metadata), owner=Depends(get_current_owner_id)):
    require_metadata(settings, metadata)
    destination = str(payload.folder_id) if payload.folder_id else None
    identifiers = list(dict.fromkeys(map(str, payload.file_ids)))
    timestamp = utc_timestamp()
    updates = []
    for ident in identifiers:
        values = {":active": "active", ":uploaded": "uploaded", ":at": timestamp}
        if destination:
            values[":folder"] = destination
        updates.append({"Update": {
            "TableName": metadata.table_name,
            "Key": serialize_item(file_key(owner, ident)),
            "ConditionExpression": ("upload_state = :uploaded AND "
                                    "(attribute_not_exists(lifecycle_state) OR lifecycle_state = :active)"),
            "UpdateExpression": ("SET folder_updated_at = :at, folder_id = :folder" if destination
                                 else "SET folder_updated_at = :at REMOVE folder_id"),
            "ExpressionAttributeValues": serialize_item(values),
        }})
    try:
        if destination and metadata.get_file(f"!folders!{owner}", destination) is None:
            raise HTTPException(404, "Không tìm thấy thư mục đích")
        call_dynamodb(metadata.client, "transact_write_items", TransactItems=updates)
    except DynamoDBError as exc:
        if exc.code == "TransactionCanceledException":
            raise HTTPException(409, "Không thể chuyển nhóm tệp. Hãy tải lại danh sách và thử lại.") from None
        raise metadata_failure(exc) from None
    return {"folder_id": destination, "moved": len(identifiers)}

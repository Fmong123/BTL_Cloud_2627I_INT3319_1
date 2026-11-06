"""Owner-only folder trees; optimistic transactions protect moves and trash.

Folders never change S3 keys, scan results or quota. A shared revision serializes
tree changes, file moves and uploads into folders across API workers.
"""
from datetime import datetime, timedelta
from uuid import uuid4
from fastapi import HTTPException
from ..db import call_dynamodb, file_key, serialize_item, utc_timestamp, DynamoDBError
from .lifecycle import FileLifecycle, state, expired, validate_name, RETENTION_DAYS, notification_put

MAX_TREE_CHANGE = 97  # 100 DynamoDB actions minus revision, audit and durable notice.
REVISION_ID = "!revision"


def folder_view(row):
    return {"id": row["file_id"], "name": row["name"], "parent_id": row.get("parent_id"),
            "lifecycle_state": state(row), "trashed_at": row.get("trashed_at"),
            "trash_expires_at": row.get("trash_expires_at"), "trash_root_id": row.get("trash_root_id"),
            "purging": row.get("purging", False)}


def path_names(rows, ident):
    names, seen = [], set()
    while ident and ident not in seen:
        seen.add(ident)
        row = rows.get(ident)
        if row is None:
            break
        names.insert(0, row["name"])
        ident = row.get("parent_id")
    return names


class Folders:
    def __init__(self, metadata, owner, audit=None):
        self.metadata, self.owner, self.audit = metadata, owner, audit
        self.partition = f"!folders!{owner}"
        revision = metadata.get_file(self.partition, REVISION_ID)
        self.revision = revision.get("revision") if revision else None
        self.rows = {r["file_id"]: r for r in self.read_partition(self.partition) if r["file_id"] != REVISION_ID}

    def read_partition(self, owner):
        rows, cursor = [], None
        while True:
            page = self.metadata.list_files(owner, limit=100, start_key=cursor)
            rows.extend(page.items)
            cursor = page.next_key
            if not cursor:
                return rows

    def get(self, ident, *, active=True):
        row = self.rows.get(ident)
        if row is None:
            raise HTTPException(404, "Không tìm thấy thư mục")
        if active and state(row) != "active":
            raise HTTPException(409, "Thư mục đang ở Thùng rác. Hãy khôi phục trước.")
        return row

    def parent(self, ident):
        if ident:
            self.get(ident)

    def revision_action(self):
        return {"Update": {"TableName": self.metadata.table_name,
            "Key": serialize_item(file_key(self.partition, REVISION_ID)),
            "UpdateExpression": "SET revision = :next",
            "ConditionExpression": "revision = :old" if self.revision else "attribute_not_exists(revision)",
            "ExpressionAttributeValues": serialize_item({":next": str(uuid4()), **({":old": self.revision} if self.revision else {})})}}

    def commit(self, changes, ident, action, *, message=None, folder_id=None):
        if len(changes) > MAX_TREE_CHANGE:
            raise HTTPException(409, "Thao tác vượt giới hạn 97 tệp/thư mục mỗi lần. Hãy chia nhỏ nội dung trước khi thực hiện.")
        actions = [self.revision_action(), *changes]
        event, stamp = str(uuid4()), utc_timestamp()
        if self.audit:
            actions.append(self.audit.event_put(self.owner, ident, event, action,
                                               self.owner, stamp, {"items": len(changes)}))
        titles = {"folder_created": "Đã tạo thư mục", "folder_renamed": "Đã đổi tên thư mục",
                  "folder_moved": "Đã di chuyển thư mục", "files_moved": "Đã di chuyển tệp",
                  "folder_trashed": "Đã chuyển thư mục và nội dung vào Thùng rác",
                  "folder_restored": "Đã khôi phục thư mục và nội dung", "folder_purged": "Đã xóa vĩnh viễn thư mục"}
        if action in titles:
            actions.append(notification_put(self.metadata, self.owner, None, "folder-" + event, stamp,
                action.replace("_", "-"), titles[action],
                message or self.rows.get(ident, {}).get("name", "Thư mục của bạn"), "success",
                folder_id=folder_id if action == "files_moved" else (None if action == "folder_purged" else ident),
                destination="trash" if action in {"folder_trashed", "folder_purged"} else "files"))
        try:
            call_dynamodb(self.metadata.client, "transact_write_items", TransactItems=actions)
        except DynamoDBError as exc:
            if exc.code == "TransactionCanceledException":
                raise HTTPException(409, "Thư mục hoặc tệp vừa thay đổi. Hãy làm mới rồi thử lại.") from None
            raise

    def update(self, row, fields, *, guard="", values=None):
        names, bindings, sets = {}, dict(values or {}), []
        for i, (name, value) in enumerate(fields.items()):
            names[f"#n{i}"], bindings[f":v{i}"] = name, value
            sets.append(f"#n{i} = :v{i}")
        names["#life"], bindings[":life"] = "lifecycle_state", state(row)
        condition = "attribute_exists(file_id) AND (#life = :life"
        if state(row) == "active":
            condition += " OR attribute_not_exists(#life)"
        condition += ")"
        if row.get("lifecycle_updated_at"):
            bindings[":life_at"] = row["lifecycle_updated_at"]
            condition += " AND lifecycle_updated_at = :life_at"
        else:
            condition += " AND attribute_not_exists(lifecycle_updated_at)"
        return {"Update": {"TableName": self.metadata.table_name,
            "Key": serialize_item(file_key(row["owner_id"], row["file_id"])),
            "UpdateExpression": "SET " + ", ".join(sets), "ConditionExpression": condition + guard,
            "ExpressionAttributeNames": names, "ExpressionAttributeValues": serialize_item(bindings)}}

    def name(self, value, parent, exclude=None):
        try:
            result = validate_name(value)
            if len(result) > 120:
                raise ValueError("Tên thư mục tối đa 120 ký tự")
        except ValueError as exc:
            raise HTTPException(400, str(exc).replace("Tên tệp", "Tên thư mục")) from None
        if any(r["file_id"] != exclude and state(r) == "active" and r.get("parent_id") == parent
               and r["name"].casefold() == result.casefold() for r in self.rows.values()):
            raise HTTPException(409, "Đã có thư mục cùng tên tại vị trí này")
        return result

    def create(self, name, parent):
        self.parent(parent)
        row = {**file_key(self.partition, str(uuid4())), "name": self.name(name, parent),
               "parent_id": parent, "created_at": utc_timestamp()}
        put = {"Put": {"TableName": self.metadata.table_name, "Item": serialize_item(row),
                       "ConditionExpression": "attribute_not_exists(file_id)"}}
        self.commit([put], row["file_id"], "folder_created", message=row["name"])
        return folder_view(row)

    def rename(self, ident, name):
        row = self.get(ident)
        fields = {"name": self.name(name, row.get("parent_id"), ident)}
        self.commit([self.update(row, fields)], ident, "folder_renamed", message=fields["name"])
        return folder_view({**row, **fields})

    def move(self, ident, parent):
        row = self.get(ident)
        self.parent(parent)
        seen, current = {ident}, parent
        while current:
            if current in seen:
                raise HTTPException(409, "Không thể chuyển thư mục vào chính nó hoặc thư mục con")
            seen.add(current)
            current = self.get(current).get("parent_id")
        self.name(row["name"], parent, ident)
        self.commit([self.update(row, {"parent_id": parent})], ident, "folder_moved")
        return folder_view({**row, "parent_id": parent})

    def move_files(self, identifiers, destination):
        self.parent(destination)
        changes, stamp = [], utc_timestamp()
        for ident in dict.fromkeys(identifiers):
            row = self.metadata.get_file(self.owner, ident)
            if not row:
                raise HTTPException(404, "Không tìm thấy tệp thuộc tài khoản của bạn")
            if state(row) != "active" or row.get("upload_state") != "uploaded":
                raise HTTPException(409, "Chỉ di chuyển tệp đã tải lên và không ở Thùng rác")
            changes.append(self.update(row, {"folder_id": destination, "folder_updated_at": stamp},
                guard=" AND upload_state = :uploaded", values={":uploaded": "uploaded"}))
        self.commit(changes, str(uuid4()), "files_moved", folder_id=destination,
                    message=f"{len(changes)} tệp → {self.rows[destination]['name'] if destination else 'Tệp của tôi'}")
        return {"folder_id": destination, "moved": len(changes)}

    def subtree(self, ident):
        result, pending = set(), [ident]
        while pending:
            current = pending.pop()
            if current in result:
                raise HTTPException(409, "Cấu trúc thư mục không hợp lệ")
            result.add(current)
            pending.extend(r["file_id"] for r in self.rows.values()
                           if r.get("parent_id") == current and state(r) == "active")
        return result

    def trash(self, ident):
        root = self.get(ident, active=False)
        if state(root) == "trashed":
            return {"id": ident, "trashed": True}
        ids = self.subtree(ident)
        files = [r for r in self.read_partition(self.owner) if r.get("folder_id") in ids and state(r) == "active"]
        if any(r.get("pipeline_busy") or r.get("upload_state") not in {"uploaded", "failed"} or r.get("status") in {"scanning", "flagged"} for r in files):
            raise HTTPException(409, "Có tệp đang tải lên, đang quét hoặc chờ cách ly. Hãy chờ xử lý hoàn tất trước khi xóa thư mục.")
        stamp = utc_timestamp()
        expiry = utc_timestamp((datetime.fromisoformat(stamp.replace("Z", "+00:00")) + timedelta(days=RETENTION_DAYS)).isoformat())
        fields = {"lifecycle_state": "trashed", "lifecycle_updated_at": stamp,
                  "trashed_at": stamp, "trash_expires_at": expiry, "trash_root_id": ident}
        changes = [self.update(self.rows[i], fields) for i in ids]
        for row in files:
            changes.append(self.update(row, fields,
                guard=" AND upload_state IN (:uploaded, :failed) AND #scan <> :scanning AND #scan <> :flagged AND (attribute_not_exists(pipeline_busy) OR pipeline_busy = :pipeline_idle)",
                values={":uploaded": "uploaded", ":failed": "failed", ":scanning": "scanning", ":flagged": "flagged", ":pipeline_idle": False}))
            changes[-1]["Update"]["ExpressionAttributeNames"]["#scan"] = "status"
        self.commit(changes, ident, "folder_trashed")
        return {"id": ident, "trashed": True, "files": len(files), "folders": len(ids)}

    def trash_group(self, ident):
        root = self.get(ident, active=False)
        if state(root) != "trashed" or root.get("trash_root_id") != ident:
            raise HTTPException(409, "Hãy xử lý thư mục gốc đã đưa vào Thùng rác")
        folders = [r for r in self.rows.values() if r.get("trash_root_id") == ident and state(r) == "trashed"]
        files = [r for r in self.read_partition(self.owner) if r.get("trash_root_id") == ident and state(r) != "active"]
        return root, folders, files

    def restore(self, ident):
        root = self.get(ident, active=False)
        if state(root) == "active":
            return {"id": ident, "restored": True}
        root, folders, files = self.trash_group(ident)
        if root.get("purging") or expired(root) or any(expired(r) or state(r) != "trashed" for r in files):
            raise HTTPException(409, "Nội dung đã hết hạn khôi phục hoặc đang được xóa")
        parent = root.get("parent_id")
        if parent and (parent not in self.rows or state(self.rows[parent]) != "active"):
            parent = None
        name = root["name"]
        try:
            self.name(name, parent, ident)
        except HTTPException:
            name = self.name(f"{name[:77]} (khôi phục {str(uuid4())[:8]})", parent, ident)
        stamp, changes = utc_timestamp(), []
        for row in [*folders, *files]:
            fields = {"lifecycle_state": "active", "lifecycle_updated_at": stamp, "trash_root_id": None}
            if row["file_id"] == ident and row["owner_id"] == self.partition:
                fields.update(parent_id=parent, name=name)
            changes.append(self.update(row, fields))
        self.commit(changes, ident, "folder_restored")
        return {"id": ident, "restored": True, "parent_id": parent}

    def purge(self, ident, storage, settings):
        root, folders, files = self.trash_group(ident)
        # A claimed group cannot be restored during destructive storage work.
        if not root.get("purging"):
            self.commit([self.update(root, {"purging": True})], ident, "folder_purge_started")
        for row in files:
            FileLifecycle(self.metadata, storage, settings).purge(row)
        latest = Folders(self.metadata, self.owner, self.audit)
        changes = [{"Delete": {"TableName": self.metadata.table_name,
            "Key": serialize_item(file_key(self.partition, r["file_id"]))}} for r in folders]
        latest.commit(changes, ident, "folder_purged")
        return {"id": ident, "deleted": True}

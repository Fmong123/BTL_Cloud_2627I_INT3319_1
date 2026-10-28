"""Phase 3 runs the real FastAPI routes with no AWS/network dependencies."""

from copy import deepcopy
from io import BytesIO

import boto3
from botocore.exceptions import ClientError
from fastapi.testclient import TestClient
import pytest

from app.config import MIB, Settings
from app.db import deserialize_item, serialize_item
from app.dependencies import get_dev_owner_id
from app.main import create_app
from app.services.s3_storage import S3Storage
from app.services.storage import LocalStorage, StorageFailure, StorageTooLarge

STAMP = "2026-10-27T00:00:00.000Z"
KEY = "uploads/dev-user/file-1/notes.txt"


def record(**changes):
    return {
        "owner_id": "dev-user", "file_id": "file-1", "original_name": "ghi chú.txt",
        "key": KEY, "size_bytes": 5, "content_type": "text/plain", "storage": "local",
        "upload_state": "uploaded", "status": "safe", "findings_count": 0,
        "finding_types": [], "created_at": STAMP, "updated_at": STAMP, **changes,
    }


class FakeDynamo:
    def __init__(self, *items):
        self.items = {(r["owner_id"], r["file_id"]): deepcopy(r) for r in items}
        self.updates = []
        self.before_update = None
        self.error = None

    def get_item(self, **kwargs):
        if self.error:
            raise ClientError({"Error": {"Code": self.error}}, "GetItem")
        key = deserialize_item(kwargs["Key"])
        item = self.items.get((key["owner_id"], key["file_id"]))
        return {"Item": serialize_item(item)} if item else {}

    def query(self, **kwargs):
        owner = deserialize_item(kwargs["ExpressionAttributeValues"])[":partition"]
        return {"Items": [serialize_item(item) for (who, _), item in self.items.items() if who == owner]}

    def update_item(self, **kwargs):
        self.updates.append(kwargs)
        key = deserialize_item(kwargs["Key"])
        identity = key["owner_id"], key["file_id"]
        if self.before_update:
            self.before_update(self.items, identity)
        if identity not in self.items:
            raise ClientError({"Error": {"Code": "ConditionalCheckFailedException"}}, "UpdateItem")
        assert kwargs["UpdateExpression"] == "SET #starred = :starred, #starred_updated = :timestamp"
        assert kwargs["ConditionExpression"] == "attribute_exists(#owner) AND attribute_exists(#file)"
        values = deserialize_item(kwargs["ExpressionAttributeValues"])
        self.items[identity].update(starred=values[":starred"], starred_updated_at=values[":timestamp"])
        return {"Attributes": serialize_item(self.items[identity])}


@pytest.fixture(autouse=True)
def no_aws(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("Phase 3 tests must not create AWS clients")
    monkeypatch.setattr(boto3, "client", forbidden)


def app_for(tmp_path, *items, storage=None, **settings):
    db = FakeDynamo(*(items or (record(),)))
    app = create_app(
        Settings(storage_mode="local", local_storage_dir=tmp_path, metadata_mode="dynamodb", **settings),
        storage=storage or LocalStorage(tmp_path), dynamodb_client=db,
    )
    path = tmp_path / KEY
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"hello")
    return app, db


def test_star_persists_and_does_not_overwrite_concurrent_scan(tmp_path):
    app, db = app_for(tmp_path)
    def scan_wins(items, identity):
        items[identity].update(status="quarantined", updated_at="2026-10-27T01:00:00.000Z", finding_types=["EMAIL"], findings_count=1)
    db.before_update = scan_wins
    with TestClient(app) as client:
        initial = client.get("/files").json()["items"][0]
        assert initial["starred"] is False and initial["starred_updated_at"] is None
        response = client.patch("/files/file-1/preferences", json={"starred": True})
        assert response.status_code == 200
        assert response.json()["id"] == "file-1" and response.json()["starred"] is True
        assert response.json()["starred_updated_at"].endswith("Z")
        listed = client.get("/files").json()["items"][0]
        assert listed["starred"] is True and listed["scan_status"] == "quarantined"
        assert listed["updated_at"] == "2026-10-27T01:00:00.000Z"
        assert listed["upload_state"] == "uploaded" and listed["finding_types"] == ["EMAIL"]
        assert client.patch("/files/file-1/preferences", json={"starred": False}).json()["starred"] is False
    assert len(db.updates) == 2


@pytest.mark.parametrize("body", [{}, {"starred": 1}, {"starred": "true"}, {"starred": None}, {"starred": True, "status": "safe"}])
def test_preferences_strict_input_does_not_write(tmp_path, body):
    app, db = app_for(tmp_path)
    with TestClient(app) as client:
        assert client.patch("/files/file-1/preferences", json=body).status_code == 422
    assert not db.updates


def test_preferences_conditional_missing_and_other_owner(tmp_path):
    app, db = app_for(tmp_path)
    with TestClient(app) as client:
        assert client.patch("/files/missing/preferences", json={"starred": True}).status_code == 404
        app.dependency_overrides[get_dev_owner_id] = lambda: "other-user"
        assert client.patch("/files/file-1/preferences", json={"starred": True}).status_code == 404
        assert client.get("/files/file-1/content").status_code == 404
        assert client.get("/files").json()["items"] == []
        app.dependency_overrides.clear()
        db.before_update = lambda items, identity: items.pop(identity)
        assert client.patch("/files/file-1/preferences", json={"starred": True}).status_code == 404


def test_local_content_and_safe_headers_and_cors(tmp_path):
    app, _ = app_for(tmp_path, record(original_name='..\\ghi chú"\r\n.txt'))
    with TestClient(app) as client:
        response = client.get("/files/file-1/content", headers={"Origin": "http://localhost:5173"})
        assert response.status_code == 200 and response.content == b"hello"
        assert response.headers["content-length"] == "5"
        assert response.headers["content-type"] == "application/octet-stream"
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["x-content-type-options"] == "nosniff"
        disposition = response.headers["content-disposition"]
        assert disposition.startswith("attachment;") and "filename*=UTF-8''" in disposition
        assert "\r" not in disposition and "\n" not in disposition and "%C3%BA" in disposition
        assert "Content-Disposition" in response.headers["access-control-expose-headers"]
        preview = client.get("/files/file-1/content?mode=preview")
        assert preview.status_code == 200 and preview.headers["content-type"].startswith("text/plain")
        assert preview.headers["content-disposition"].startswith("inline;")
        cors = client.options("/files/file-1/preferences", headers={
            "Origin": "http://localhost:5173", "Access-Control-Request-Method": "PATCH",
            "Access-Control-Request-Headers": "Content-Type",
        })
        assert cors.status_code == 200 and "PATCH" in cors.headers["access-control-allow-methods"]


@pytest.mark.parametrize("state", ["not_started", "scanning", "flagged", "quarantined", "quarantine_delete_failed", "unscanned", "error"])
def test_scan_denials_never_touch_storage(tmp_path, state):
    class NeverRead(LocalStorage):
        def read(self, **kwargs):
            raise AssertionError("Unsafe files must never reach storage")
    app, _ = app_for(tmp_path, record(status=state), storage=NeverRead(tmp_path))
    with TestClient(app) as client:
        for mode in ("preview", "download"):
            assert client.get(f"/files/file-1/content?mode={mode}").status_code == 409


@pytest.mark.parametrize("state", ["uploading", "failed", "unknown"])
def test_noncompleted_upload_denied(tmp_path, state):
    app, _ = app_for(tmp_path, record(upload_state=state))
    with TestClient(app) as client:
        assert client.get("/files/file-1/content").status_code == 409


@pytest.mark.parametrize("key", ["uploads/other/file-1/a.txt", "quarantine/dev-user/file-1/a.txt", "uploads/dev-user/other/a.txt", "uploads/dev-user/file-1/../notes.txt", "uploads/dev-user/file-1/C:secret", "uploads/dev-user/file-1/a\\b.txt"])
def test_metadata_key_escape_denied(tmp_path, key):
    app, _ = app_for(tmp_path, record(key=key))
    with TestClient(app) as client:
        response = client.get("/files/file-1/content?key=uploads/dev-user/file-1/notes.txt&bucket=other")
        assert response.status_code == 503


@pytest.mark.parametrize("mime,limit", [
    ("image/png", 10 * MIB), ("image/jpeg", 10 * MIB), ("image/gif", 10 * MIB),
    ("image/webp", 10 * MIB), ("application/pdf", 20 * MIB),
    ("text/plain", MIB), ("text/csv", MIB), ("application/json", MIB),
])
def test_preview_limits_enforced_before_read(tmp_path, mime, limit):
    app, _ = app_for(tmp_path, record(content_type=mime, size_bytes=limit + 1))
    with TestClient(app) as client:
        assert client.get("/files/file-1/content?mode=preview").status_code == 413


@pytest.mark.parametrize("mime", ["text/html", "image/svg+xml", "application/octet-stream"])
def test_unsupported_preview_still_allows_download(tmp_path, mime):
    app, _ = app_for(tmp_path, record(content_type=mime, original_name="data.bin"))
    with TestClient(app) as client:
        assert client.get("/files/file-1/content?mode=preview").status_code == 415
        assert client.get("/files/file-1/content?mode=download").status_code == 200


def test_local_actual_length_utf8_missing_and_symlink_guards(tmp_path):
    app, db = app_for(tmp_path)
    with TestClient(app) as client:
        (tmp_path / KEY).write_bytes(b"\xffabcd")
        assert client.get("/files/file-1/content?mode=preview").status_code == 415
        (tmp_path / KEY).write_bytes(b"different")
        assert client.get("/files/file-1/content").status_code == 502
        (tmp_path / KEY).write_bytes(b"a" * (MIB + 1))
        assert client.get("/files/file-1/content?mode=preview").status_code == 413
        (tmp_path / KEY).unlink()
        assert client.get("/files/file-1/content").status_code == 404
        assert client.get("/files/missing/content").status_code == 404
        db.items[("dev-user", "file-1")]["size_bytes"] = 100 * MIB + 1
        assert client.get("/files/file-1/content").status_code == 413
    with pytest.raises(StorageFailure):
        LocalStorage(tmp_path).read(key="../private", max_bytes=1)


class TrackedBody(BytesIO):
    def __init__(self, value, *, fail=False):
        super().__init__(value)
        self.requested = []
        self.fail = fail

    def read(self, count=-1):
        self.requested.append(count)
        if self.fail:
            raise OSError("private bucket/credential path")
        return super().read(count)


class FakeS3:
    def __init__(self, body=None, length=5, code=None):
        self.body, self.length, self.code = body or TrackedBody(b"hello"), length, code
        self.calls = []

    def get_object(self, **kwargs):
        self.calls.append(kwargs)
        if self.code:
            raise ClientError({"Error": {"Code": self.code, "Message": "private-secret"}}, "GetObject")
        return {"Body": self.body, "ContentLength": self.length}


def s3_app(tmp_path, sdk, **changes):
    storage = S3Storage(bucket="approved-bucket", client=sdk, transfer_config=object(), uploader=lambda *a, **k: k["key"])
    return app_for(tmp_path, record(storage="s3", upload_bucket="approved-bucket", **changes), storage=storage, s3_bucket_name="approved-bucket")


def test_s3_reads_only_owned_record_and_closes_body(tmp_path):
    sdk = FakeS3()
    app, _ = s3_app(tmp_path, sdk)
    with TestClient(app) as client:
        assert client.get("/health").json()["capabilities"] == {"persistent_favorites": True, "file_content": True}
        response = client.get("/files/file-1/content?bucket=hostile&key=private")
        assert response.status_code == 200 and response.content == b"hello"
    assert sdk.calls == [{"Bucket": "approved-bucket", "Key": KEY}]
    assert sdk.body.closed and max(sdk.body.requested) <= MIB


@pytest.mark.parametrize("kind,expected", [("oversize_header", 413), ("oversize_body", 413), ("read_error", 502), ("missing", 404), ("denied", 502), ("wrong_length", 502)])
def test_s3_errors_are_private_bounded_and_closed(tmp_path, kind, expected):
    body = TrackedBody(b"a" * (MIB + 1) if kind == "oversize_body" else b"hello", fail=kind == "read_error")
    sdk = FakeS3(body=body, length=MIB + 1 if kind == "oversize_header" else 5, code={"missing": "NoSuchKey", "denied": "AccessDenied"}.get(kind))
    app, _ = s3_app(tmp_path, sdk, size_bytes=4 if kind == "wrong_length" else 5)
    with TestClient(app) as client:
        response = client.get("/files/file-1/content?mode=preview")
        assert response.status_code == expected
        assert "private" not in response.text and "approved-bucket" not in response.text
    if kind not in {"missing", "denied"}:
        assert body.closed
    if kind == "oversize_header":
        assert not body.requested
    if kind == "oversize_body":
        assert sum(body.requested) == MIB + 1


def test_wrong_bucket_and_storage_mode_unavailable(tmp_path):
    sdk = FakeS3()
    app, db = s3_app(tmp_path, sdk)
    with TestClient(app) as client:
        db.items[("dev-user", "file-1")]["upload_bucket"] = "other-bucket"
        assert client.get("/files/file-1/content").status_code == 503
        db.items[("dev-user", "file-1")]["storage"] = "local"
        assert client.get("/files/file-1/content").status_code == 503
    assert not sdk.calls


def test_capabilities_and_unconfigured_endpoints(tmp_path):
    with TestClient(create_app(Settings(), storage=LocalStorage(tmp_path))) as client:
        assert client.get("/health").json()["capabilities"] == {"persistent_favorites": False, "file_content": False}
        assert client.get("/files/file-1/content").status_code == 503
        assert client.patch("/files/file-1/preferences", json={"starred": True}).status_code == 503
    class UploadOnly:
        mode, configured = "local", True
    app, _ = app_for(tmp_path, storage=UploadOnly())
    with TestClient(app) as client:
        assert client.get("/health").json()["capabilities"] == {"persistent_favorites": True, "file_content": False}
        assert client.get("/files/file-1/content").status_code == 503
        app.state.file_metadata = None
        assert client.get("/health").json()["capabilities"] == {"persistent_favorites": False, "file_content": False}


def test_invalid_metadata_and_dynamo_failure_private(tmp_path):
    app, db = app_for(tmp_path, record(starred="true"))
    with TestClient(app) as client:
        assert client.get("/files").status_code == 503
        assert client.get("/files/file-1/content").status_code == 503
        assert client.patch("/files/file-1/preferences", json={"starred": True}).status_code == 503
        db.error = "PrivateProviderDetails"
        response = client.get("/files/file-1/content")
        assert response.status_code == 503 and "PrivateProviderDetails" not in response.text
    assert not db.updates


@pytest.mark.parametrize("mime,body", [
    ("image/png", b"\x89PNG\r\n\x1a\n"), ("image/jpeg", b"\xff\xd8\xff"),
    ("image/gif", b"GIF89a"), ("image/webp", b"RIFFabcdWEBP"),
    ("application/pdf", b"%PDF-1.7"), ("text/csv", "tên,giá\n".encode()),
    ("application/json", b'{"ok":true}'),
])
def test_allowlisted_preview_returns_exact_bytes(tmp_path, mime, body):
    app, _ = app_for(tmp_path, record(content_type=mime, size_bytes=len(body)))
    (tmp_path / KEY).write_bytes(body)
    with TestClient(app) as client:
        response = client.get("/files/file-1/content?mode=preview")
        assert response.status_code == 200 and response.content == body
        assert response.headers["content-type"].split(";")[0] == mime


def test_exact_read_boundary_and_one_byte_overflow_close_s3_body():
    exact = FakeS3(body=TrackedBody(b"12345"), length=5)
    adapter = S3Storage(bucket="approved", client=exact, transfer_config=object(), uploader=lambda **k: k["key"])
    assert adapter.read(key="trusted", max_bytes=5) == b"12345"
    assert exact.body.closed
    overflow = FakeS3(body=TrackedBody(b"123456789"), length=5)
    adapter.client = overflow
    with pytest.raises(StorageTooLarge):
        adapter.read(key="trusted", max_bytes=5)
    assert overflow.body.closed and sum(overflow.body.requested) == 6


def test_read_adapter_without_s3_get_object_not_advertised(tmp_path):
    class UploadOnlyS3:
        pass
    app, _ = s3_app(tmp_path, UploadOnlyS3())
    with TestClient(app) as client:
        assert client.get("/health").json()["capabilities"]["file_content"] is False
        assert client.get("/files/file-1/content").status_code == 503


@pytest.mark.parametrize("extension,mime", [("txt", "text/plain"), ("CSV", "text/csv"), ("json", "application/json")])
def test_generic_binary_text_extension_fallback_still_requires_utf8(tmp_path, extension, mime):
    app, _ = app_for(tmp_path, record(content_type="application/octet-stream", original_name=f"notes.{extension}"))
    with TestClient(app) as client:
        response = client.get("/files/file-1/content?mode=preview")
        assert response.status_code == 200 and response.headers["content-type"].startswith(mime)
        (tmp_path / KEY).write_bytes(b"\xffabcd")
        assert client.get("/files/file-1/content?mode=preview").status_code == 415


def test_explicit_html_type_cannot_be_overridden_by_text_extension(tmp_path):
    app, _ = app_for(tmp_path, record(content_type="text/html", original_name="unsafe.txt"))
    with TestClient(app) as client:
        assert client.get("/files/file-1/content?mode=preview").status_code == 415

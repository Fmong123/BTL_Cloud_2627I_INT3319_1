from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.body_limit import MULTIPART_ALLOWANCE
from app.config import Settings
from app.dependencies import get_storage
from app.main import create_app
from app.services.storage import (
    LocalStorage, StoredObject, StorageFailure, StorageUnavailable,
)


class RecordingStorage:
    mode = "s3"
    configured = True

    def __init__(self):
        self.calls = []

    def upload(self, file_obj, *, key, content_type):
        self.calls.append((file_obj.read(), key, content_type, file_obj))
        return StoredObject(key=key, storage="s3")


def make_client(storage=None, *, limit=32, directory=Path("unused")):
    return TestClient(create_app(Settings(max_file_size_bytes=limit, local_storage_dir=directory), storage))


def test_app_starts_without_aws_and_upload_is_not_fake_success():
    with make_client() as client:
        assert client.get("/health").json() == {
            "status": "ok", "storage": "unconfigured", "storage_configured": False,
            "max_file_size_bytes": 32, "scan_status": "not_started",
        }
        assert client.get("/docs").status_code == 200
        assert "/upload" in client.get("/openapi.json").json()["paths"]
        response = client.post("/upload", files={"file": ("x.txt", b"hello")})
        assert response.status_code == 503
        assert isinstance(response.json()["detail"], str)
        assert "id" not in response.json()


@pytest.mark.parametrize("content,status", [(b"", 400), (b"x" * 33, 413)])
def test_validation_precedes_storage(content, status):
    storage = RecordingStorage()
    with make_client(storage) as client:
        response = client.post("/upload", files={"file": ("x.txt", content)})
    assert response.status_code == status
    assert isinstance(response.json()["detail"], str)
    assert storage.calls == []


def test_exact_limit_contents_rewind_close_and_response_contract():
    storage = RecordingStorage()
    with make_client(storage) as client:
        response = client.post("/upload", files={"file": ("notes.txt", b"x" * 32, "text/plain")})
    assert response.status_code == 201
    data = response.json()
    UUID(data["id"])
    assert data["key"] == f"uploads/dev-user/{data['id']}/notes.txt"
    assert data["storage"] == "s3"  # Fake adapter contract test, not an AWS integration test.
    assert data["size_bytes"] == 32
    assert data["original_name"] == "notes.txt"
    assert data["content_type"] == "text/plain"
    assert data["scan_status"] == "not_started"
    content, key, content_type, handle = storage.calls[0]
    assert (content, key, content_type) == (b"x" * 32, data["key"], "text/plain")
    assert handle.closed


def test_missing_or_non_file_field_has_string_error():
    with make_client() as client:
        for response in [client.post("/upload"), client.post("/upload", data={"file": "text"})]:
            assert response.status_code == 422
            assert isinstance(response.json()["detail"], str)


def test_two_same_names_do_not_overwrite(tmp_path):
    with make_client(LocalStorage(tmp_path)) as client:
        first = client.post("/upload", files={"file": ("same.txt", b"first")}).json()
        second = client.post("/upload", files={"file": ("same.txt", b"second")}).json()
    assert first["id"] != second["id"] and first["key"] != second["key"]
    assert first["storage"] == second["storage"] == "local"
    assert (tmp_path / first["key"]).read_bytes() == b"first"
    assert (tmp_path / second["key"]).read_bytes() == b"second"


@pytest.mark.parametrize("filename", ["../../escape.txt", r"..\..\CON.txt", "AUX", "LPT1.pdf", "a" * 119 + ".tail", "báo cáo?.txt"])
def test_local_filename_is_safe_on_windows_and_stays_inside_root(tmp_path, filename):
    with make_client(LocalStorage(tmp_path)) as client:
        response = client.post("/upload", files={"file": (filename, b"bytes")})
    assert response.status_code == 201
    data = response.json()
    target = (tmp_path / data["key"]).resolve()
    assert target.is_relative_to(tmp_path.resolve())
    assert target.read_bytes() == b"bytes"
    assert not target.name.endswith(".")
    assert "\\" not in data["key"]


def test_local_storage_rejects_bad_keys(tmp_path):
    from io import BytesIO
    with pytest.raises(StorageFailure):
        LocalStorage(tmp_path).upload(BytesIO(b"x"), key="../outside", content_type="text/plain")


def test_write_failure_returns_error_and_cleans_partial_files(tmp_path, monkeypatch):
    def fail_replace(*args):
        raise OSError("private-path-and-secret")

    monkeypatch.setattr("app.services.storage.os.replace", fail_replace)
    with make_client(LocalStorage(tmp_path)) as client:
        response = client.post("/upload", files={"file": ("x.txt", b"hello")})
    assert response.status_code == 502
    assert "private-path-and-secret" not in response.text
    assert list(tmp_path.rglob("*.part")) == []
    assert list(tmp_path.rglob("x.txt")) == []


@pytest.mark.parametrize("exception,status", [
    (StorageUnavailable("credential-data"), 503), (StorageFailure("credential-data"), 502),
    (RuntimeError("credential-data"), 502),
])
def test_adapter_failures_never_leak_or_claim_success(exception, status):
    class FailingStorage(RecordingStorage):
        def upload(self, file_obj, *, key, content_type):
            raise exception

    with make_client(FailingStorage()) as client:
        response = client.post("/upload", files={"file": ("x.txt", b"hello")})
    assert response.status_code == status
    assert "credential-data" not in response.text
    assert "id" not in response.json()


def test_storage_dependency_is_replaceable_without_rewriting_route():
    storage = RecordingStorage()
    app = create_app(Settings())
    app.dependency_overrides[get_storage] = lambda: storage
    with TestClient(app) as client:
        assert client.post("/upload", files={"file": ("x.txt", b"injected")}).status_code == 201
    assert storage.calls[0][0] == b"injected"


def test_cors_preflight_error_and_disallowed_origin():
    with make_client() as client:
        origin = "http://127.0.0.1:5173"
        preflight = client.options("/upload", headers={
            "Origin": origin, "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        })
        assert preflight.status_code == 200
        assert preflight.headers["access-control-allow-origin"] == origin
        failure = client.post("/upload", files={"file": ("x.txt", b"x")}, headers={"Origin": origin})
        assert failure.status_code == 503
        assert failure.headers["access-control-allow-origin"] == origin
        blocked = client.options("/upload", headers={"Origin": "http://other.example", "Access-Control-Request-Method": "POST"})
        assert blocked.status_code == 400
        assert "access-control-allow-origin" not in blocked.headers


def test_body_limit_rejects_large_declared_request_with_cors():
    with make_client() as client:
        response = client.post("/upload", content=b"x", headers={
            "Content-Length": str(32 + MULTIPART_ALLOWANCE + 1),
            "Origin": "http://localhost:5173", "Content-Type": "multipart/form-data; boundary=part",
        })
    assert response.status_code == 413
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_body_limit_counts_streamed_bytes_without_content_length():
    def content():
        yield b'--part\r\nContent-Disposition: form-data; name="file"; filename="x.txt"\r\n\r\n'
        for _ in range(20):
            yield b"x" * 65536
        yield b"\r\n--part--\r\n"

    with make_client() as client:
        response = client.post("/upload", content=content(), headers={"Content-Type": "multipart/form-data; boundary=part"})
    assert response.status_code == 413
    assert isinstance(response.json()["detail"], str)

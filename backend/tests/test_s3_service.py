"""Verify Sang's real uploader, including the normal application entrypoint."""

import importlib.util
import inspect
from io import BytesIO
from pathlib import Path

import boto3
from boto3.s3.transfer import TransferConfig
from botocore.exceptions import ClientError, EndpointConnectionError, NoCredentialsError
from botocore.stub import Stubber
from fastapi.testclient import TestClient
import pytest

from app.config import MIB
from app.services.s3_service import upload_to_s3


class RecordingClient:
    def __init__(self, error=None):
        self.error = error
        self.calls = []
        self.handles = []
        self.closed = False

    def upload_fileobj(self, **kwargs):
        self.handles.append(kwargs["Fileobj"])
        if self.error is not None:
            raise self.error
        self.calls.append((kwargs["Fileobj"].read(), kwargs))

    def close(self):
        self.closed = True


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_service_import_does_not_create_aws_client(monkeypatch):
    def forbid_client(*args, **kwargs):
        pytest.fail("Importing the uploader must not create an AWS client")

    monkeypatch.setattr(boto3, "client", forbid_client)
    module = load_module(
        "app.services._uploader_import_test",
        Path(__file__).resolve().parents[1] / "app/services/s3_service.py",
    )
    assert callable(module.upload_to_s3)


def test_real_service_preserves_key_stream_and_transfer_options():
    client = RecordingClient()
    stream = BytesIO(b"hello")
    transfer = object()
    result = upload_to_s3(
        stream, key="uploads/user/id/file.txt", content_type="text/plain",
        client=client, bucket="test-bucket", transfer_config=transfer,
    )
    assert result == "uploads/user/id/file.txt"
    assert client.calls == [(b"hello", {
        "Fileobj": stream, "Bucket": "test-bucket", "Key": result,
        "ExtraArgs": {"ContentType": "text/plain"}, "Config": transfer,
    })]
    signature = inspect.signature(upload_to_s3)
    for name in ("key", "content_type", "client", "bucket", "transfer_config"):
        assert signature.parameters[name].kind == inspect.Parameter.KEYWORD_ONLY


def load_s3_entrypoint(monkeypatch, client):
    monkeypatch.setenv("MAYSEC_STORAGE_MODE", "s3")
    monkeypatch.setenv("S3_BUCKET_NAME", "test-bucket")
    monkeypatch.setenv("AWS_REGION", "ap-southeast-1")
    monkeypatch.setenv("MAYSEC_MAX_FILE_SIZE_BYTES", "5")
    monkeypatch.setenv("MAYSEC_S3_MULTIPART_THRESHOLD_BYTES", str(16 * MIB))
    monkeypatch.setenv("MAYSEC_S3_MULTIPART_CHUNKSIZE_BYTES", str(8 * MIB))
    monkeypatch.setenv("MAYSEC_S3_MAX_CONCURRENCY", "2")
    monkeypatch.setattr(boto3, "client", lambda *args, **kwargs: client)
    return load_module(
        "app._entrypoint_upload_test",
        Path(__file__).resolve().parents[1] / "app/main.py",
    ).app


def test_normal_entrypoint_uses_real_uploader_and_validates_file(monkeypatch):
    sdk = RecordingClient()
    app = load_s3_entrypoint(monkeypatch, sdk)
    with TestClient(app) as api:
        health = api.get("/health").json()
        assert health["storage"] == "s3" and health["storage_configured"] is True
        response = api.post("/upload", files={"file": ("hello.txt", b"hello", "text/plain")})
        assert response.status_code == 201
        result = response.json()
        assert result["storage"] == "s3" and result["size_bytes"] == 5
        assert result["scan_status"] == "not_started"
        data, kwargs = sdk.calls[0]
        assert data == b"hello"
        assert kwargs["Key"] == result["key"]
        assert kwargs["Bucket"] == "test-bucket"
        assert kwargs["ExtraArgs"] == {"ContentType": "text/plain"}
        assert kwargs["Config"].multipart_threshold == 16 * MIB
        assert kwargs["Config"].multipart_chunksize == 8 * MIB
        assert kwargs["Config"].max_concurrency == 2
        assert kwargs["Fileobj"].closed
        assert api.post("/upload", files={"file": ("empty.txt", b"")}).status_code == 400
        assert api.post("/upload", files={"file": ("big.txt", b"123456")}).status_code == 413
        assert api.post("/upload").status_code == 422
        assert len(sdk.calls) == 1
    assert sdk.closed


@pytest.mark.parametrize("error,status", [
    (NoCredentialsError(), 503),
    (ClientError({"Error": {"Code": "AccessDenied", "Message": "private-detail"}}, "PutObject"), 502),
    (EndpointConnectionError(endpoint_url="https://private.example"), 502),
    (RuntimeError("private-detail"), 502),
])
def test_real_uploader_http_failures_close_file_and_keep_errors_private(monkeypatch, error, status):
    sdk = RecordingClient(error)
    with TestClient(load_s3_entrypoint(monkeypatch, sdk)) as api:
        response = api.post("/upload", files={"file": ("hello.txt", b"hello")})
        assert response.status_code == status
        assert "private-detail" not in response.text
        assert "private.example" not in response.text
        assert "id" not in response.json()
    assert len(sdk.handles) == 1 and sdk.handles[0].closed
    assert sdk.closed


@pytest.mark.parametrize("multipart", [False, True])
def test_real_boto3_transfer_completes_without_network(multipart):
    sdk = boto3.client(
        "s3", region_name="ap-southeast-1",
        aws_access_key_id="testing", aws_secret_access_key="testing",
    )
    transfer = TransferConfig(
        multipart_threshold=16 * MIB, multipart_chunksize=8 * MIB,
        max_concurrency=1, preferred_transfer_client="classic",
    )
    payload = b"x" * (17 * MIB) if multipart else b"hello"
    try:
        with Stubber(sdk) as stub:
            if multipart:
                stub.add_response("create_multipart_upload", {"UploadId": "test-upload"})
                for _ in range(3):
                    stub.add_response("upload_part", {"ETag": '"test-part"'})
                stub.add_response("complete_multipart_upload", {"ETag": '"test-complete"'})
            else:
                stub.add_response("put_object", {"ETag": '"test"'})
            result = upload_to_s3(
                BytesIO(payload), key="uploads/id/file.bin",
                content_type="application/octet-stream", client=sdk,
                bucket="test-bucket", transfer_config=transfer,
            )
            assert result == "uploads/id/file.bin"
            stub.assert_no_pending_responses()
    finally:
        sdk.close()

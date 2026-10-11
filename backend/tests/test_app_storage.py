import sys

import boto3
from botocore.exceptions import PartialCredentialsError
from fastapi.testclient import TestClient
import pytest

from app.config import MIB, Settings
from app.main import create_app
from app.services.s3_storage import S3Storage
from app.services.storage import LocalStorage


def s3_settings(**changes):
    return Settings(
        storage_mode="s3", s3_bucket_name="test-bucket",
        aws_region="ap-southeast-1", **changes,
    )


def forbid_client(*args, **kwargs):
    raise AssertionError("This path must not create an AWS client")


@pytest.mark.parametrize("mode", ["unconfigured", "local", "s3"])
def test_startup_without_uploader_never_creates_aws_client(mode, tmp_path, monkeypatch):
    monkeypatch.setattr(boto3, "client", forbid_client)
    settings = s3_settings() if mode == "s3" else Settings(
        storage_mode=mode, local_storage_dir=tmp_path,
    )
    with TestClient(create_app(settings)) as client:
        health = client.get("/health").json()
        assert health["storage"] == mode
        assert health["storage_configured"] is (mode == "local")
        response = client.post("/upload", files={"file": ("x.txt", b"hello")})
        assert response.status_code == (201 if mode == "local" else 503)
    assert "app.services.s3_service" not in sys.modules


def test_factory_connects_uploader_client_transfer_settings_and_closes_client(monkeypatch):
    class Client:
        closed = False

        def close(self):
            self.closed = True

        def upload_fileobj(self, file_obj, bucket, key, *, ExtraArgs, Config):
            self.upload = (file_obj.read(), bucket, key, ExtraArgs, Config, file_obj)

    sdk_client = Client()
    client_calls = []

    def make_client(service, **kwargs):
        client_calls.append((service, kwargs))
        return sdk_client

    def uploader(file_obj, *, key, content_type, client, bucket, transfer_config):
        client.upload_fileobj(
            file_obj, bucket, key, ExtraArgs={"ContentType": content_type},
            Config=transfer_config,
        )
        return key

    monkeypatch.setattr(boto3, "client", make_client)
    settings = s3_settings(
        s3_multipart_threshold_bytes=20 * MIB,
        s3_multipart_chunksize_bytes=10 * MIB, s3_max_concurrency=3,
    )
    app = create_app(settings, s3_uploader=uploader)
    assert isinstance(app.state.storage, S3Storage)
    with TestClient(app) as client:
        assert client.get("/health").json()["storage_configured"] is True
        response = client.post("/upload", files={"file": ("notes.txt", b"hello", "text/plain")})
        assert response.status_code == 201
        assert response.json()["storage"] == "s3"
        assert response.json()["scan_status"] == "not_started"
        assert not sdk_client.closed
    assert sdk_client.closed
    service, options = client_calls[0]
    assert len(client_calls) == 1
    assert service == "s3" and options["region_name"] == settings.aws_region
    assert options["config"].signature_version == "s3v4"
    data, bucket, key, extra, transfer, handle = sdk_client.upload
    assert data == b"hello" and bucket == "test-bucket"
    assert key == response.json()["key"] and extra == {"ContentType": "text/plain"}
    assert transfer.multipart_threshold == 20 * MIB
    assert transfer.multipart_chunksize == 10 * MIB
    assert transfer.max_concurrency == 3
    assert transfer.preferred_transfer_client == "classic"
    assert handle.closed


def test_injected_storage_takes_priority_and_is_not_closed(monkeypatch, tmp_path):
    monkeypatch.setattr(boto3, "client", forbid_client)
    storage = LocalStorage(tmp_path)
    app = create_app(s3_settings(), storage=storage)
    with TestClient(app) as client:
        assert app.state.storage is storage
        assert client.get("/health").json()["storage"] == "local"
        assert client.post("/upload", files={"file": ("x.txt", b"hello")}).status_code == 201


def test_injected_s3_client_is_not_closed(monkeypatch):
    monkeypatch.setattr(boto3, "client", forbid_client)

    class ExternalClient:
        def close(self):
            raise AssertionError("The caller owns this client")

    storage = S3Storage(
        bucket="test-bucket", client=ExternalClient(),
        transfer_config=object(), uploader=lambda *args, **kwargs: kwargs["key"],
    )
    with TestClient(create_app(s3_settings(), storage=storage)) as client:
        assert client.get("/health").json()["storage_configured"] is True


def test_sdk_initialization_failure_keeps_upload_unavailable_and_private(monkeypatch, caplog):
    def fail_client(*args, **kwargs):
        raise PartialCredentialsError(provider="private-provider", cred_var="private-value")

    monkeypatch.setattr(boto3, "client", fail_client)
    with TestClient(create_app(s3_settings(), s3_uploader=lambda *args, **kwargs: None)) as client:
        assert client.get("/health").json()["storage_configured"] is False
        response = client.post("/upload", files={"file": ("x.txt", b"hello")})
        assert response.status_code == 503
        assert "id" not in response.json()
    assert "private-provider" not in caplog.text + response.text
    assert "private-value" not in caplog.text + response.text

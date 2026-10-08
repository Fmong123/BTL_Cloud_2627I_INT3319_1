from io import BytesIO

import pytest
from botocore.exceptions import (
    ClientError,
    EndpointConnectionError,
    NoCredentialsError,
    NoRegionError,
    PartialCredentialsError,
    ReadTimeoutError,
)
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.services.s3_storage import S3Storage
from app.services.storage import StorageFailure, StorageUnavailable, StoredObject


def make_storage(uploader_fn, **overrides):
    params = dict(
        bucket="test-bucket", client=object(), transfer_config=object(), uploader=uploader_fn,
    )
    params.update(overrides)
    return S3Storage(**params)


def test_passes_stream_and_dependencies_and_confirms_original_key():
    stream = BytesIO(b"hello")
    calls = []

    def uploader(file_obj, **kwargs):
        calls.append((file_obj, kwargs, file_obj.read()))
        return kwargs["key"]

    storage = make_storage(uploader)
    result = storage.upload(stream, key="uploads/u/id/file.txt", content_type="text/plain")
    assert result == StoredObject(key="uploads/u/id/file.txt", storage="s3")
    assert storage.mode == "s3" and storage.configured
    assert calls == [(stream, dict(
        key=result.key, content_type="text/plain", client=storage.client,
        bucket="test-bucket", transfer_config=storage.transfer_config,
    ), b"hello")]
    assert not stream.closed


@pytest.mark.parametrize("overrides", [
    {"bucket": "  "}, {"client": None}, {"transfer_config": None}, {"uploader": None},
])
def test_missing_dependencies_fail_without_calling_uploader(overrides):
    def uploader(*args, **kwargs):
        pytest.fail("Unconfigured adapter must not call AWS")

    storage = make_storage(uploader, **overrides)
    assert not storage.configured
    with pytest.raises(StorageUnavailable):
        storage.upload(BytesIO(b"hello"), key="k", content_type="text/plain")


@pytest.mark.parametrize("confirmation", [None, True, "different-key", {"key": "k"}])
def test_invalid_confirmation_cannot_become_success(confirmation):
    storage = make_storage(lambda *args, **kwargs: confirmation)
    with pytest.raises(StorageFailure):
        storage.upload(BytesIO(b"hello"), key="k", content_type="text/plain")


@pytest.mark.parametrize("error,expected", [
    (NoCredentialsError(), StorageUnavailable),
    (PartialCredentialsError(provider="test", cred_var="secret_key"), StorageUnavailable),
    (NoRegionError(), StorageUnavailable),
    (ClientError({"Error": {"Code": "AccessDenied", "Message": "private-details"}}, "PutObject"), StorageFailure),
    (EndpointConnectionError(endpoint_url="https://private.example"), StorageFailure),
    (ReadTimeoutError(endpoint_url="https://private.example"), StorageFailure),
    (OSError("private-details"), StorageFailure),
])
def test_sdk_configuration_and_write_errors_are_mapped(error, expected):
    def uploader(*args, **kwargs):
        raise error

    stream = BytesIO(b"hello")
    with pytest.raises(expected) as caught:
        make_storage(uploader).upload(stream, key="k", content_type="text/plain")
    assert caught.value.__cause__ is error
    assert "private" not in str(caught.value)
    assert not stream.closed


def test_route_validates_rewinds_and_closes_file_after_s3_confirmation():
    streams = []

    def uploader(file_obj, **kwargs):
        streams.append(file_obj)
        assert file_obj.tell() == 0
        assert file_obj.read() == b"hello"
        return kwargs["key"]

    with TestClient(create_app(Settings(), storage=make_storage(uploader))) as client:
        response = client.post("/upload", files={"file": ("hello.txt", b"hello", "text/plain")})
    assert response.status_code == 201
    data = response.json()
    assert data["storage"] == "s3"
    assert data["key"] == f"uploads/dev-user/{data['id']}/hello.txt"
    assert data["size_bytes"] == 5
    assert data["scan_status"] == "not_started"
    assert streams[0].closed


@pytest.mark.parametrize("error,status", [
    (NoCredentialsError(), 503),
    (ClientError({"Error": {"Code": "AccessDenied", "Message": "secret-provider-detail"}}, "PutObject"), 502),
    (RuntimeError("secret-provider-detail"), 502),
])
def test_route_keeps_error_details_private_and_closes_handle(error, status):
    streams = []

    def uploader(file_obj, **kwargs):
        streams.append(file_obj)
        raise error

    with TestClient(create_app(Settings(), storage=make_storage(uploader))) as client:
        response = client.post("/upload", files={"file": ("hello.txt", b"hello")})
    assert response.status_code == status
    assert "secret-provider-detail" not in response.text
    assert "id" not in response.json()
    assert streams[0].closed


def test_route_rejects_missing_service_and_unconfirmed_result():
    for uploader, status in [(None, 503), (lambda *args, **kwargs: None, 502)]:
        with TestClient(create_app(Settings(), storage=make_storage(uploader))) as client:
            response = client.post("/upload", files={"file": ("hello.txt", b"hello")})
        assert response.status_code == status
        assert "storage" not in response.json()

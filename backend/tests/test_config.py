import os

import pytest

from app.config import BACKEND_DIR, MIB, Settings


@pytest.fixture
def clean_env(monkeypatch):
    for name in tuple(os.environ):
        if name.startswith("MAYSEC_") or name in {"S3_BUCKET_NAME", "AWS_REGION"}:
            monkeypatch.delenv(name)


def test_defaults_do_not_require_aws(clean_env):
    settings = Settings.from_env()
    assert settings.storage_mode == "unconfigured"
    assert settings.local_storage_dir == BACKEND_DIR / "data"
    assert settings.max_file_size_bytes == 100 * MIB
    assert settings.s3_bucket_name == settings.aws_region == ""


def test_environment_s3_configuration_and_existing_options(clean_env, monkeypatch):
    values = {
        "MAYSEC_STORAGE_MODE": " S3 ",
        "S3_BUCKET_NAME": " test-bucket ",
        "AWS_REGION": " ap-southeast-1 ",
        "MAYSEC_MAX_FILE_SIZE_BYTES": str(50 * MIB),
        "MAYSEC_LOCAL_STORAGE_DIR": "custom-data",
        "MAYSEC_CORS_ORIGINS": " http://localhost:5173, ,http://localhost:3000 ",
        "MAYSEC_S3_MULTIPART_THRESHOLD_BYTES": str(20 * MIB),
        "MAYSEC_S3_MULTIPART_CHUNKSIZE_BYTES": str(10 * MIB),
        "MAYSEC_S3_MAX_CONCURRENCY": "3",
    }
    for name, value in values.items():
        monkeypatch.setenv(name, value)
    settings = Settings.from_env()
    assert settings.storage_mode == "s3"
    assert settings.s3_bucket_name == "test-bucket"
    assert settings.aws_region == "ap-southeast-1"
    assert settings.max_file_size_bytes == 50 * MIB
    assert settings.local_storage_dir == BACKEND_DIR / "custom-data"
    assert settings.cors_origins == ("http://localhost:5173", "http://localhost:3000")
    assert settings.s3_multipart_threshold_bytes == 20 * MIB
    assert settings.s3_multipart_chunksize_bytes == 10 * MIB
    assert settings.s3_max_concurrency == 3


@pytest.mark.parametrize("changes,message", [
    ({"storage_mode": "invalid"}, "MAYSEC_STORAGE_MODE"),
    ({"max_file_size_bytes": 0}, "MAYSEC_MAX_FILE_SIZE_BYTES"),
    ({"s3_multipart_threshold_bytes": 0}, "MAYSEC_S3_MULTIPART_THRESHOLD_BYTES"),
    ({"s3_multipart_chunksize_bytes": 5 * MIB - 1}, "MAYSEC_S3_MULTIPART_CHUNKSIZE_BYTES"),
    ({"s3_multipart_chunksize_bytes": 5 * 1024 * MIB + 1}, "MAYSEC_S3_MULTIPART_CHUNKSIZE_BYTES"),
    ({"s3_max_concurrency": 0}, "MAYSEC_S3_MAX_CONCURRENCY"),
    ({"storage_mode": "s3", "s3_bucket_name": " "}, "S3_BUCKET_NAME"),
    ({"storage_mode": "s3", "s3_bucket_name": "bucket", "aws_region": " "}, "AWS_REGION"),
])
def test_invalid_settings_fail_early(changes, message):
    with pytest.raises(ValueError, match=message):
        Settings(**changes)


def test_invalid_numeric_environment_fails(clean_env, monkeypatch):
    monkeypatch.setenv("MAYSEC_S3_MAX_CONCURRENCY", "not-a-number")
    with pytest.raises(ValueError):
        Settings.from_env()


def test_local_absolute_directory_is_preserved(clean_env, monkeypatch, tmp_path):
    monkeypatch.setenv("MAYSEC_STORAGE_MODE", "local")
    monkeypatch.setenv("MAYSEC_LOCAL_STORAGE_DIR", str(tmp_path))
    assert Settings.from_env().local_storage_dir == tmp_path.resolve()

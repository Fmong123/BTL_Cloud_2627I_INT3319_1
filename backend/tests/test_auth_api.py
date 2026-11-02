"""Tests for Cognito authentication API and role-based access control."""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.services.cognito_auth import AuthError, AuthUser


class StubVerifier:
    def __init__(self, user: AuthUser):
        self.user = user

    def verify(self, token: str) -> AuthUser:
        if token == "valid-token":
            return self.user
        raise AuthError(401, "Token không hợp lệ")


def test_me_unauthorized_missing_token_returns_401(tmp_path):
    user = AuthUser(owner_id="00000000-0000-0000-0000-000000000001", role="user")
    settings = Settings(
        auth_mode="cognito", storage_mode="local", local_storage_dir=tmp_path,
        cognito_user_pool_id="ap-southeast-2_TestPool", cognito_app_client_id="testclient",
    )
    app = create_app(settings, auth_verifier=StubVerifier(user))
    with TestClient(app) as client:
        response = client.get("/me")
        assert response.status_code == 401
        assert "bearer" in response.headers.get("www-authenticate", "").lower()
        assert response.json()["detail"] == "Cần đăng nhập để sử dụng chức năng này"


def test_me_authenticated_user_role(tmp_path):
    user_id = "11111111-1111-1111-1111-111111111111"
    user = AuthUser(owner_id=user_id, role="user")
    settings = Settings(
        auth_mode="cognito", storage_mode="local", local_storage_dir=tmp_path,
        cognito_user_pool_id="ap-southeast-2_TestPool", cognito_app_client_id="testclient",
    )
    app = create_app(settings, auth_verifier=StubVerifier(user))
    with TestClient(app) as client:
        response = client.get("/me", headers={"Authorization": "Bearer valid-token"})
        assert response.status_code == 200
        assert response.json() == {"id": user_id, "role": "user"}


def test_me_authenticated_admin_role(tmp_path):
    admin_id = "22222222-2222-2222-2222-222222222222"
    admin = AuthUser(owner_id=admin_id, role="admin")
    settings = Settings(
        auth_mode="cognito", storage_mode="local", local_storage_dir=tmp_path,
        cognito_user_pool_id="ap-southeast-2_TestPool", cognito_app_client_id="testclient",
    )
    app = create_app(settings, auth_verifier=StubVerifier(admin))
    with TestClient(app) as client:
        response = client.get("/me", headers={"Authorization": "Bearer valid-token"})
        assert response.status_code == 200
        assert response.json() == {"id": admin_id, "role": "admin"}


def test_me_unconfigured_cognito_returns_503(tmp_path):
    settings = Settings(
        auth_mode="cognito", storage_mode="local", local_storage_dir=tmp_path,
        cognito_user_pool_id="", cognito_app_client_id="",
    )
    app = create_app(settings)
    with TestClient(app) as client:
        response = client.get("/me")
        assert response.status_code == 503
        assert response.json()["detail"] == "Dịch vụ xác thực chưa được cấu hình"


def test_upload_requires_auth_and_persists_with_owner_id(tmp_path):
    owner_id = "33333333-3333-3333-3333-333333333333"
    user = AuthUser(owner_id=owner_id, role="user")
    settings = Settings(
        auth_mode="cognito", storage_mode="local", local_storage_dir=tmp_path,
        cognito_user_pool_id="ap-southeast-2_TestPool", cognito_app_client_id="testclient",
    )
    app = create_app(settings, auth_verifier=StubVerifier(user))
    with TestClient(app) as client:
        # (1) Không đăng nhập (vẫn gửi kèm một tệp hợp lệ) -> 401
        unauthed = client.post("/upload", files={"file": ("hello.txt", b"hello content", "text/plain")})
        assert unauthed.status_code == 401
        assert "bearer" in unauthed.headers.get("www-authenticate", "").lower()

        # (2) Với người dùng giả lập -> 201 và key lưu có dạng uploads/<owner_id>/<file_id>/<tên>
        authed = client.post(
            "/upload",
            files={"file": ("hello.txt", b"hello content", "text/plain")},
            headers={"Authorization": "Bearer valid-token"},
        )
        assert authed.status_code == 201
        data = authed.json()
        expected_key = f"uploads/{owner_id}/{data['id']}/hello.txt"
        assert data["key"] == expected_key
        assert (tmp_path / expected_key).read_bytes() == b"hello content"


def test_dev_auth_mode_not_allowed_with_s3_storage():
    with pytest.raises(ValueError, match="MAYSEC_AUTH_MODE=dev is not allowed with S3 storage"):
        Settings(
            auth_mode="dev", storage_mode="s3",
            s3_bucket_name="b", aws_region="ap-southeast-2",
        )

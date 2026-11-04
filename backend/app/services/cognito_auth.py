"""Xác minh access token của Amazon Cognito (Hosted UI, Authorization Code + PKCE).

Module này không phụ thuộc FastAPI để dễ kiểm thử. Backend không bao giờ thấy mật khẩu:
người dùng đăng nhập ở trang Cognito, frontend gửi `Authorization: Bearer <access_token>`.

Quy tắc xác minh (mọi bước đều bắt buộc, lỗi nào cũng từ chối):
  - Chữ ký RS256 theo khóa công khai (JWKS) của đúng User Pool; thuật toán bị ghim cứng.
  - `iss` đúng User Pool, còn hạn (`exp`).
  - `token_use == "access"` (không chấp nhận ID token).
  - `client_id` đúng App client của MaySec (access token không có `aud`).
  - `sub` là UUID; dùng làm owner_id và nằm trong key S3, nên phải kiểm tra chặt.
  - Vai trò lấy từ claim `cognito:groups`: nhóm `admin` hoặc `user`.
"""

from __future__ import annotations

from dataclasses import dataclass
import logging
import re
from typing import Any, Iterable, Protocol
from uuid import UUID

import jwt
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientConnectionError

logger = logging.getLogger(__name__)

ROLE_ADMIN = "admin"
ROLE_USER = "user"
GROUPS_CLAIM = "cognito:groups"
USER_POOL_ID_PATTERN = re.compile(r"^[a-z]{2}(?:-[a-z]+)+-\d_[A-Za-z0-9]+$")


@dataclass(frozen=True)
class AuthUser:
    owner_id: str  # claim `sub` của Cognito; ánh xạ với PK `owner_id` của bảng files/users
    role: str      # "admin" hoặc "user"
    username: str = ""


class AuthError(Exception):
    """Lỗi xác thực/phân quyền; `status_code` là mã HTTP tương ứng."""

    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message


class SigningKeyProvider(Protocol):
    def get_signing_key_from_jwt(self, token: str) -> Any: ...


def role_from_groups(groups: Iterable[Any]) -> str | None:
    """admin ưu tiên hơn user; không thuộc nhóm nào thì không có vai trò."""
    names = {g for g in groups if isinstance(g, str)}
    if ROLE_ADMIN in names:
        return ROLE_ADMIN
    if ROLE_USER in names:
        return ROLE_USER
    return None


class CognitoVerifier:
    def __init__(
        self, *, user_pool_id: str, app_client_id: str,
        jwks_client: SigningKeyProvider | None = None,
    ) -> None:
        if not USER_POOL_ID_PATTERN.match(user_pool_id):
            raise ValueError("COGNITO_USER_POOL_ID không đúng định dạng <region>_<id>")
        if not app_client_id.strip():
            raise ValueError("COGNITO_APP_CLIENT_ID là bắt buộc")
        region = user_pool_id.split("_", 1)[0]
        self.issuer = f"https://cognito-idp.{region}.amazonaws.com/{user_pool_id}"
        self.app_client_id = app_client_id.strip()
        # Chưa gọi mạng khi khởi tạo; khóa được tải và cache ở lần xác minh đầu tiên.
        self._jwks = jwks_client or PyJWKClient(
            f"{self.issuer}/.well-known/jwks.json",
            cache_keys=True, lifespan=3600, timeout=5,
        )

    def verify(self, token: str) -> AuthUser:
        try:
            signing_key = self._jwks.get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token, signing_key.key, algorithms=["RS256"], issuer=self.issuer,
                options={"require": ["exp", "iss", "sub"], "verify_aud": False},
            )
        except jwt.ExpiredSignatureError:
            raise AuthError(401, "Phiên đăng nhập đã hết hạn — hãy đăng nhập lại") from None
        except PyJWKClientConnectionError:
            logger.error("Không tải được JWKS của Cognito")
            raise AuthError(503, "Chưa xác thực được lúc này — thử lại sau") from None
        except jwt.PyJWTError:
            raise AuthError(401, "Token không hợp lệ") from None

        if claims.get("token_use") != "access":
            raise AuthError(401, "Token không hợp lệ")
        if claims.get("client_id") != self.app_client_id:
            raise AuthError(401, "Token không hợp lệ")
        try:
            owner_id = str(UUID(str(claims["sub"])))
        except (ValueError, KeyError):
            raise AuthError(401, "Token không hợp lệ") from None

        groups = claims.get(GROUPS_CLAIM)
        role = role_from_groups(groups if isinstance(groups, list) else [])
        if role is None:
            raise AuthError(403, "Tài khoản chưa được cấp quyền sử dụng hệ thống")
        return AuthUser(owner_id=owner_id, role=role, username=str(claims.get("username", "")))


def build_verifier(settings: Any) -> CognitoVerifier | None:
    """Trả None nếu chạy chế độ dev hoặc chưa cấu hình Cognito (API sẽ trả 503, không mở cửa)."""
    if settings.auth_mode != "cognito":
        return None
    if not settings.cognito_user_pool_id or not settings.cognito_app_client_id:
        logger.warning("Cognito chưa được cấu hình; các API cần đăng nhập sẽ trả 503")
        return None
    return CognitoVerifier(
        user_pool_id=settings.cognito_user_pool_id,
        app_client_id=settings.cognito_app_client_id,
    )

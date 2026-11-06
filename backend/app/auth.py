"""Dependency FastAPI cho xác thực và phân quyền (user/admin).

Mặc định từ chối (fail closed): thiếu hoặc sai token -> 401, sai vai trò -> 403,
Cognito chưa cấu hình -> 503. Kiểm quyền luôn ở server, frontend chỉ ẩn/hiện giao diện.
"""

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .services.cognito_auth import ROLE_ADMIN, ROLE_USER, AuthError, AuthUser
from .services.demo_accounts import is_demo_token
from .db import DynamoDBError

# auto_error=False để tự trả 401 (HTTPBearer mặc định trả 403 khi thiếu header).
_bearer = HTTPBearer(auto_error=False)
_UNAUTHORIZED_HEADERS = {"WWW-Authenticate": "Bearer"}


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> AuthUser:
    # Hàm sync nên FastAPI chạy trong thread pool; lần đầu tải JWKS không chặn event loop.
    settings = request.app.state.settings
    if settings.auth_mode == "dev":
        return AuthUser(owner_id="dev-user", role=settings.dev_role, username="dev")

    verifier = request.app.state.auth_verifier
    if verifier is None and not settings.demo_login_enabled:
        raise HTTPException(503, "Dịch vụ xác thực chưa được cấu hình")
    if credentials is None or not credentials.credentials:
        raise HTTPException(401, "Cần đăng nhập để sử dụng chức năng này", headers=_UNAUTHORIZED_HEADERS)
    try:
        if is_demo_token(credentials.credentials):
            if not settings.demo_login_enabled:
                raise AuthError(401, "Chế độ demo đã tắt")
            directory = request.app.state.demo_accounts
            if directory is None:
                raise AuthError(503, "Chưa kết nối được Cognito cho demo")
            return managed_access(request, directory.verify(credentials.credentials))
        if verifier is None:
            raise AuthError(503, "Dịch vụ xác thực chưa được cấu hình")
        return managed_access(request, verifier.verify(credentials.credentials))
    except AuthError as exc:
        headers = _UNAUTHORIZED_HEADERS if exc.status_code == 401 else None
        raise HTTPException(exc.status_code, exc.message, headers=headers) from None


def managed_access(request, user):
    """Apply confirmed management changes to already-issued Cognito access tokens."""
    profiles = request.app.state.user_profiles
    if request.app.state.settings.metadata_mode != "dynamodb":
        return user
    if profiles is None:
        raise HTTPException(503, "Chưa kiểm tra được trạng thái tài khoản")
    try:
        profile = profiles.get(user.owner_id)
    except DynamoDBError:
        raise HTTPException(503, "Chưa kiểm tra được trạng thái tài khoản") from None
    if profile.get("management_pending"):
        raise HTTPException(403, "Tài khoản đang chờ đối chiếu thay đổi quản trị")
    if profile.get("access_disabled"):
        raise HTTPException(401, "Tài khoản đã bị tạm khóa", headers=_UNAUTHORIZED_HEADERS)
    policy_role = profile.get("managed_role", user.role)
    if policy_role not in {ROLE_USER, ROLE_ADMIN}:
        raise HTTPException(403, "Tài khoản chưa được gán quyền truy cập")
    # A stored policy may restrict an old JWT, but never grant privileges absent
    # from a newly verified Cognito token. Promotions need refreshed group claims.
    role = ROLE_USER if policy_role == ROLE_USER else user.role
    return AuthUser(owner_id=user.owner_id, username=user.username, role=role)


def require_role(*roles: str):
    """Dùng: `user: AuthUser = Depends(require_role("admin"))`."""
    allowed = frozenset(roles)

    def checker(user: AuthUser = Depends(get_current_user)) -> AuthUser:
        if user.role not in allowed:
            raise HTTPException(403, "Bạn không có quyền thực hiện thao tác này")
        return user

    return checker


require_admin = require_role(ROLE_ADMIN)
require_any_role = require_role(ROLE_ADMIN, ROLE_USER)

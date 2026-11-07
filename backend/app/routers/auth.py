import logging
from uuid import UUID
from fastapi import APIRouter, Depends, Request, HTTPException, Response
from pydantic import BaseModel, ConfigDict

from ..auth import get_current_user
from ..schemas.auth import MeResponse
from ..schemas.file import ErrorResponse
from ..services.cognito_auth import AuthUser, AuthError
from ..db import DynamoDBError

logger = logging.getLogger(__name__)

router = APIRouter(responses={
    401: {"model": ErrorResponse, "description": "Missing, invalid or expired access token"},
    403: {"model": ErrorResponse, "description": "Account has no permitted role"},
    503: {"model": ErrorResponse, "description": "Cognito configuration or JWKS unavailable"},
})


@router.get("/me", response_model=MeResponse)
def me(request: Request, response: Response, user: AuthUser = Depends(get_current_user)) -> MeResponse:
    """Frontend gọi để biết vai trò hiện tại (ẩn/hiện trang quản trị). Không trả email."""
    response.headers["Cache-Control"] = "no-store"
    if request.app.state.settings.auth_mode == "cognito":
        directory = request.app.state.demo_accounts
        from ..services.demo_accounts import is_demo_token
        authorization = request.headers.get("authorization", "").partition(" ")[2]
        if directory is not None and is_demo_token(authorization):
            account = directory.account(user.owner_id)
        else:
            account = {"id": user.owner_id, "username": user.username,
                       "name": user.username or user.owner_id, "role": user.role, "active": True}
        sync_profile(request, account, login=True)
    return MeResponse(id=user.owner_id, role=user.role)


def sync_profile(request, account, *, login=False):
    if request.app.state.settings.metadata_mode != "dynamodb":
        return
    profiles = request.app.state.user_profiles
    if profiles is None:
        raise HTTPException(503, "Chưa kết nối được bảng hồ sơ người dùng")
    try:
        profiles.sync(account, login=login)
        metadata = request.app.state.file_metadata
        if metadata is not None and account.get("role") == "user":
            from ..services.billing import account as billing_account, reconcile_roster
            from ..services.quota import QuotaBusy
            try:
                billing_account(metadata, account["id"])
                reconcile_roster(metadata, {account["id"]: account}, complete=False)
            except (DynamoDBError, QuotaBusy):
                logger.warning("Billing account observation deferred")
    except DynamoDBError as exc:
        logger.warning("User profile synchronization failed (%s)", exc.code)
        raise HTTPException(503, "Chưa đồng bộ được securedrive-users. Kiểm tra quyền dynamodb:UpdateItem của backend.") from None


def demo_directory(request):
    if not request.app.state.settings.demo_login_enabled:
        raise HTTPException(404, "Chế độ chọn tài khoản demo đang tắt")
    directory = request.app.state.demo_accounts
    if directory is None:
        raise HTTPException(503, "Chưa kết nối được Cognito cho demo")
    return directory


@router.get("/auth/config")
def auth_config(request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return {"demo_enabled": request.app.state.settings.demo_login_enabled,
            "auth_mode": request.app.state.settings.auth_mode}


@router.get("/auth/demo/accounts")
def demo_accounts(request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    try:
        accounts = demo_directory(request).accounts()
        for account in accounts:
            sync_profile(request, account)
        if request.app.state.file_metadata is not None:
            from ..services.billing import admin_summary
            from ..services.quota import QuotaBusy
            try:
                admin_summary(request.app.state.file_metadata, {a["id"]: a for a in accounts})
            except (DynamoDBError, QuotaBusy):
                logger.warning("Billing directory reconciliation deferred")
        return {"items": accounts, "refresh_seconds": 30}
    except AuthError as exc:
        raise HTTPException(exc.status_code, exc.message) from None


class DemoLoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    account_id: UUID


@router.post("/auth/demo/login")
def demo_login(payload: DemoLoginRequest, request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    try:
        result = demo_directory(request).login(str(payload.account_id))
        sync_profile(request, result["user"], login=True)
        return result
    except AuthError as exc:
        raise HTTPException(exc.status_code, exc.message) from None

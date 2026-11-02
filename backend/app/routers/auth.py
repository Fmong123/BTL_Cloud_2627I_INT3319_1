from fastapi import APIRouter, Depends

from ..auth import get_current_user
from ..schemas.auth import MeResponse
from ..schemas.file import ErrorResponse
from ..services.cognito_auth import AuthUser

router = APIRouter(responses={
    401: {"model": ErrorResponse, "description": "Missing, invalid or expired access token"},
    403: {"model": ErrorResponse, "description": "Account has no permitted role"},
    503: {"model": ErrorResponse, "description": "Cognito configuration or JWKS unavailable"},
})


@router.get("/me", response_model=MeResponse)
def me(user: AuthUser = Depends(get_current_user)) -> MeResponse:
    """Frontend gọi để biết vai trò hiện tại (ẩn/hiện trang quản trị). Không trả email."""
    return MeResponse(id=user.owner_id, role=user.role)

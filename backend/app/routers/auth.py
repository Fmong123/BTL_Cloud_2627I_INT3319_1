from fastapi import APIRouter, Depends

from ..auth import get_current_user
from ..schemas.auth import MeResponse
from ..services.cognito_auth import AuthUser

router = APIRouter()


@router.get("/me", response_model=MeResponse)
def me(user: AuthUser = Depends(get_current_user)) -> MeResponse:
    """Frontend gọi để biết vai trò hiện tại (ẩn/hiện trang quản trị). Không trả email."""
    return MeResponse(id=user.owner_id, role=user.role)

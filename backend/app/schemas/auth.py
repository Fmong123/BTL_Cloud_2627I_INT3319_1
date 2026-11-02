from pydantic import BaseModel


class MeResponse(BaseModel):
    id: str    # owner_id (sub của Cognito)
    role: str  # "admin" hoặc "user"

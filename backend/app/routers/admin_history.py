"""Central administrative history; no edit/delete/export side effects."""
from datetime import date, datetime, timedelta
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from ..auth import require_admin
from ..db import DynamoDBError
from ..services.admin_history import get_history, list_history, CATEGORIES, OUTCOMES
from ..services.admin_reports import VN
from ..services.admin_scope import user_account
from .admin import pool_accounts

router = APIRouter(dependencies=[Depends(require_admin)])


def context(request, user):
    state = request.app.state
    if not state.audit_log or not state.file_metadata:
        raise HTTPException(503, "Lịch sử quản trị cần kết nối metadata và audit")
    accounts = pool_accounts(request, fresh=True)
    current = accounts.get(user.owner_id)
    if not current or current.get("role") != "admin" or not current.get("active"):
        raise HTTPException(403, "Tài khoản hiện tại không còn quyền quản trị")
    return state.audit_log, state.file_metadata, accounts


def failure():
    return HTTPException(503, "Chưa đọc được lịch sử quản trị. Kiểm tra kết nối và quyền đọc bảng audit của backend.")


@router.get("/admin/history")
def history(request: Request, response: Response, user=Depends(require_admin),
            from_date: date | None = None, to_date: date | None = None,
            owner_id: UUID | None = None,
            category: Literal["all", "account", "pipeline", "report", "trash", "billing"] = "all",
            outcome: Literal["all", "success", "failed", "pending", "unknown", "closed"] = "all",
            q: str = Query("", max_length=200), cursor: str | None = Query(None, max_length=4096),
            limit: int = Query(20, ge=1, le=50)):
    response.headers["Cache-Control"] = "no-store"
    try:
        audit, metadata, accounts = context(request, user)
        if owner_id:
            user_account(accounts, str(owner_id))
        end = to_date or datetime.now(VN).date()
        start = from_date or end - timedelta(days=min(6, end.toordinal() - 1))
        result = list_history(audit, metadata, accounts, user.owner_id, start=start, end=end,
            owner_id=str(owner_id) if owner_id else None, category=category, outcome=outcome,
            q=q, cursor=cursor, limit=limit)
        return {**result, "categories": CATEGORIES, "outcomes": OUTCOMES,
                "owners": [{"id": k, "name": v["name"]} for k, v in sorted(accounts.items()) if v.get("role") == "user"]}
    except DynamoDBError:
        raise failure() from None


@router.get("/admin/history/{event_id}")
def event(event_id: str, request: Request, response: Response, user=Depends(require_admin)):
    response.headers["Cache-Control"] = "no-store"
    if len(event_id) > 1500:
        raise HTTPException(400, "Mã sự kiện không hợp lệ")
    try:
        audit, metadata, accounts = context(request, user)
        return get_history(audit, metadata, accounts, user.owner_id, event_id)
    except DynamoDBError:
        raise failure() from None

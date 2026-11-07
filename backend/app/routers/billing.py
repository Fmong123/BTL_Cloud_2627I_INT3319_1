"""Authenticated estimates. No price-edit or payment endpoints exist."""
from contextlib import contextmanager
from uuid import UUID
from uuid import uuid4
import csv
from io import StringIO

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from ..auth import get_current_user, require_admin
from ..db import DynamoDBError, utc_timestamp
from ..services import billing
from ..services.quota import QuotaBusy
from .admin import pool_accounts

router = APIRouter()


@contextmanager
def connected(request):
    metadata = request.app.state.file_metadata
    if metadata is None:
        raise HTTPException(503, "Theo dõi chi phí cần metadata bền vững; chưa có dữ liệu để tính tiền.")
    try:
        yield metadata
    except QuotaBusy:
        raise HTTPException(409, "Dung lượng đang được cập nhật. Hãy thử lại.") from None
    except billing.PreferencesConflict:
        raise HTTPException(409, "Ngưỡng cảnh báo đã thay đổi ở phiên khác hoặc mã yêu cầu đã được dùng. Hãy cập nhật trước khi lưu lại.") from None
    except (DynamoDBError, ValueError, KeyError, TypeError):
        raise HTTPException(503, "Chưa đối chiếu được dữ liệu chi phí. Không coi lỗi này là chi phí 0 đồng.") from None


@router.get("/billing/policy")
def policy(response: Response, user=Depends(get_current_user)):
    response.headers["Cache-Control"] = "no-store"
    return billing.POLICY


@router.get("/billing/usage")
def usage(request: Request, response: Response,
          month: str | None = Query(None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"), user=Depends(get_current_user)):
    response.headers["Cache-Control"] = "no-store"
    try:
        billing.window(month)
    except ValueError:
        raise HTTPException(422, "Kỳ chi phí không hợp lệ hoặc nằm trong tương lai") from None
    with connected(request) as metadata:
        result = billing.summary(metadata, user.owner_id, month)
        billing.storage_alert(metadata, user.owner_id, current=result["usage"])
        billing.cost_alert(metadata, user.owner_id, billing.summary(metadata, user.owner_id) if month and month != billing.window()[0].strftime("%Y-%m") else result)
        return result


class Activation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    policy_version: str = Field(max_length=80)
    request_id: UUID


@router.post("/billing/activate")
def activate(payload: Activation, request: Request, response: Response, user=Depends(get_current_user)):
    response.headers["Cache-Control"] = "no-store"
    if payload.policy_version != billing.VERSION:
        raise HTTPException(409, "Chính sách đã thay đổi; hãy tải lại và xác nhận bảng giá mới.")
    with connected(request) as metadata:
        billing.activate(metadata, user.owner_id, payload.policy_version, str(payload.request_id), audit=require_audit(request))
        return billing.summary(metadata, user.owner_id)


class Preferences(BaseModel):
    model_config = ConfigDict(extra="forbid")
    budget_vnd: int = Field(strict=True, ge=0, le=1_000_000_000)
    revision: int = Field(strict=True, ge=0)
    request_id: UUID


@router.patch("/billing/preferences")
def preferences(payload: Preferences, request: Request, response: Response, user=Depends(get_current_user)):
    response.headers["Cache-Control"] = "no-store"
    with connected(request) as metadata:
        result = billing.preferences(metadata, require_audit(request), user.owner_id, payload.budget_vnd,
            payload.revision, str(payload.request_id))
        return result


@router.get("/admin/billing/usage")
def admin_usage(request: Request, response: Response,
                month: str | None = Query(None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"), user=Depends(require_admin)):
    response.headers["Cache-Control"] = "no-store"
    try:
        billing.window(month)
    except ValueError:
        raise HTTPException(422, "Kỳ chi phí không hợp lệ hoặc nằm trong tương lai") from None
    with connected(request) as metadata:
        accounts = pool_accounts(request, fresh=True)
        actor = accounts.get(user.owner_id, {})
        if actor.get("role") != "admin" or not actor.get("active"):
            raise HTTPException(403, "Tài khoản không còn quyền quản trị")
        result = billing.admin_summary(metadata, accounts, month)
        own = billing.account(metadata, user.owner_id)
        result["budget_vnd"] = own.get("budget_vnd", 100_000)
        result["preferences_revision"] = own.get("preferences_revision", 0)
        result["scope_warning"] = False
        result["reconciliation"] = billing.reconciliation_status(request.app)
        current = billing.admin_summary(metadata, accounts) if result["historical"] else result
        billing.cost_alert(metadata, user.owner_id, current, admin=True)
        return result


def verify_admin(request, user):
    actor = pool_accounts(request, fresh=True).get(user.owner_id, {})
    if actor.get("role") != "admin" or not actor.get("active"):
        raise HTTPException(403, "Tài khoản hiện tại không còn quyền quản trị")


@router.get("/admin/billing/status")
def admin_status(request: Request, response: Response, user=Depends(require_admin)):
    response.headers["Cache-Control"] = "no-store"
    with connected(request):
        verify_admin(request, user)
        return billing.reconciliation_status(request.app)


@router.get("/admin/billing/versions")
def admin_versions(request: Request, response: Response, month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    before: int | None = Query(None, ge=1), user=Depends(require_admin)):
    response.headers["Cache-Control"] = "no-store"
    validate_month(month)
    with connected(request) as metadata:
        verify_admin(request, user)
        return billing.period_versions(metadata, month, before)


@router.post("/admin/billing/reconcile")
def admin_reconcile(request: Request, response: Response, user=Depends(require_admin)):
    response.headers["Cache-Control"] = "no-store"
    with connected(request):
        verify_admin(request, user)
        audit = require_audit(request)
        try:
            status = billing.run_reconciliation(request.app)
        except QuotaBusy:
            raise HTTPException(409, "Đang có lượt đối chiếu khác. Hãy chờ kết quả rồi cập nhật lại.") from None
        audit.write_event(owner_id=user.owner_id, file_id=user.owner_id, event_id=str(uuid4()),
            occurred_at=utc_timestamp(), action="billing_reconciled", actor=user.owner_id,
            details={"owners_checked": status["owners_checked"], "repairs": status["repairs"],
                "failed_checks": status["failed_checks"]})
        return status


def require_audit(request):
    audit = request.app.state.audit_log
    if audit is None:
        raise HTTPException(503, "Thao tác chi phí cần kết nối nhật ký để đối chiếu.")
    return audit


def csv_response(request, user, data, *, admin=False):
    rows = [["BẢNG KÊ ƯỚC TÍNH — CHƯA THU TIỀN", data["month"]],
            ["Chính sách", data["policy_version"]], ["Đối chiếu lúc", data.get("checked_at", data["as_of"])]]
    if admin:
        rows += [["Bản đối chiếu", data.get("report_revision", "Trong kỳ")],
                 ["Trạng thái", {"reconciling": "Đang đối chiếu", "reconciled": "Đã đối chiếu", "open": "Đang ghi nhận"}.get(data.get("settlement_status"), "Đang ghi nhận")]]
        if "previous_total_vnd" in data:
            rows += [["Tổng bản trước (VND)", data["previous_total_vnd"]], ["Điều chỉnh (VND)", data["adjustment_vnd"]]]
    if admin:
        rows += [["Tài khoản", "Phí lưu trữ (VND)", "Phí quản trị (VND)"]]
        rows += [[r["name"], r["storage_vnd"], r["management_vnd"]] for r in data["items"]]
        rows += [["TỔNG", data["storage_vnd"], data["management_vnd"]]]
    else:
        rows += [["Ngày", "Phí lưu trữ (VND)"]]
        rows += [[r["date"], r["storage_vnd"]] for r in data["daily"]]
        rows += [["TỔNG", data["storage_vnd"]]]
    def safe(value):
        if type(value) is int:
            return value
        text = str(value)
        return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) or text.startswith(("\t", "\r")) else text
    stream = StringIO()
    csv.writer(stream).writerows([[safe(v) for v in row] for row in rows])
    require_audit(request).write_event(owner_id=user.owner_id, file_id=user.owner_id, event_id=str(uuid4()),
        occurred_at=utc_timestamp(), action="billing_report_exported", actor=user.owner_id,
        details={"format": "csv", "month": data["month"], "scope": "admin" if admin else "user"})
    return Response("\ufeff" + stream.getvalue(), media_type="text/csv; charset=utf-8", headers={
        "Cache-Control": "no-store", "Content-Disposition": f'attachment; filename="maysec-chi-phi-{"admin-" if admin else ""}{data["month"]}.csv"'})


@router.get("/billing/export")
def user_export(request: Request, month: str | None = Query(None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"), user=Depends(get_current_user)):
    validate_month(month)
    with connected(request) as metadata:
        return csv_response(request, user, billing.summary(metadata, user.owner_id, month))


@router.get("/admin/billing/export")
def admin_export(request: Request, month: str | None = Query(None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"), user=Depends(require_admin)):
    validate_month(month)
    with connected(request) as metadata:
        accounts = pool_accounts(request, fresh=True)
        actor = accounts.get(user.owner_id, {})
        if actor.get("role") != "admin" or not actor.get("active"):
            raise HTTPException(403, "Tài khoản hiện tại không còn quyền quản trị")
        return csv_response(request, user, billing.admin_summary(metadata, accounts, month), admin=True)


def validate_month(month):
    try:
        billing.window(month)
    except ValueError:
        raise HTTPException(422, "Kỳ chi phí không hợp lệ hoặc nằm trong tương lai") from None

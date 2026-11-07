from datetime import date, datetime, timedelta
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import StreamingResponse

from ..auth import require_admin
from ..db import DynamoDBError, utc_timestamp
from ..services.admin_reports import build_report, VN
from ..services.report_export import export_csv, export_pdf
from .admin import pool_accounts
from ..services.admin_scope import user_scope, user_account
from .files import require_metadata, metadata_failure, browser_content_frames

router = APIRouter(dependencies=[Depends(require_admin)])


@router.get("/admin/reports/owners")
def owners(request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    accounts = user_scope(pool_accounts(request, fresh=True))
    return {"items": [{"id": owner, "name": accounts[owner]["name"]} for owner in sorted(accounts)]}


def report_data(request: Request, from_date: date | None = None, to_date: date | None = None,
                owner_id: UUID | None = None, lifecycle: Literal["all", "active", "trashed"] = "all"):
    settings = request.app.state.settings
    metadata = request.app.state.file_metadata
    require_metadata(settings, metadata)
    end = to_date or datetime.now(VN).date()
    start = from_date or date.fromordinal(max(1, end.toordinal() - 29))
    try:
        accounts = pool_accounts(request, fresh=True)
        if owner_id:
            user_account(accounts, str(owner_id))
        return build_report(metadata, user_scope(accounts), start, end, str(owner_id) if owner_id else None, lifecycle)
    except DynamoDBError as exc:
        raise metadata_failure(exc) from None


@router.get("/admin/reports")
def report(response: Response, data=Depends(report_data)):
    response.headers["Cache-Control"] = "no-store"
    return data


@router.get("/admin/reports/export")
def export(request: Request, format: Literal["csv", "pdf"] = "csv", data=Depends(report_data), user=Depends(require_admin)):
    audit = request.app.state.audit_log
    if audit is None:
        raise HTTPException(503, "Chưa kết nối nhật ký xuất báo cáo")
    try:
        content = export_csv(data) if format == "csv" else export_pdf(data)
    except (ImportError, OSError):
        raise HTTPException(503, "Máy chủ thiếu thư viện hoặc font xuất PDF. Cần cài đầy đủ backend/requirements.txt và assets/fonts.") from None
    try:
        ident = str(uuid4())
        audit.write_event(owner_id=user.owner_id, file_id=user.owner_id, event_id=ident, occurred_at=utc_timestamp(),
                          action="admin_report_exported", actor=user.owner_id,
                          details={"format": format, "filters": data["filters"], "files": data["totals"]["files"], "generated_at": data["generated_at"]})
    except DynamoDBError as exc:
        raise metadata_failure(exc) from None
    media_type = "text/csv; charset=utf-8" if format == "csv" else "application/pdf"
    headers = {"Cache-Control": "no-store", "Vary": "Accept", "X-Content-Type-Options": "nosniff"}
    # Use the same bounded browser transport as file downloads. The app verifies
    # frame order/length/end before constructing a local CSV/PDF download.
    accept = request.headers.get("accept", "")
    if any(v.split(";", 1)[0].strip().lower() == "application/x-ndjson" for v in accept.split(",")):
        return StreamingResponse(browser_content_frames("admin-report", media_type, content),
                                 media_type="application/x-ndjson", headers=headers)
    return Response(content, media_type=media_type, headers={**headers,
                    "Content-Disposition": f'attachment; filename="maysec-report-{data["filters"]["from"]}-{data["filters"]["to"]}.{format}"'})

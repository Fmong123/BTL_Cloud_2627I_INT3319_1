"""UTF-8 Excel CSV and paginated Vietnamese PDF with bundled OFL Unicode fonts."""
import csv
from io import BytesIO, StringIO
from pathlib import Path
from xml.sax.saxutils import escape


def report_sections(report):
    t = report["totals"]
    return [
        ("Tổng hợp", ["Chỉ số", "Giá trị"], [["Tệp", t["files"]], ["Dung lượng (byte)", t["bytes"]],
            ["Tệp có phát hiện", t["detected"]], ["Số phát hiện", t["findings"]], ["Tệp lỗi", t["errors"]],
            ["Tệp thiếu chi tiết loại phát hiện", t["unknown_finding_files"]],
            ["Trích xuất trung bình (ms)", t["extraction_average_ms"] if t["extraction_average_ms"] is not None else "Chưa có mẫu"],
            ["Số tệp có thời gian trích xuất", t["extraction_files"]]]),
        ("Kết quả xử lý", ["Trạng thái", "Số tệp"], [[r["label"], r["files"]] for r in report["statuses"]]),
        ("Theo ngày tải lên", ["Ngày (UTC+7)", "Tệp", "Có phát hiện", "Lỗi"],
            [[r[k] for k in ("date", "files", "detected", "errors")] for r in report["trend"]]),
        ("Theo loại phát hiện", ["Loại", "Số phát hiện", "Số tệp"],
            [[r[k] for k in ("type", "count", "files")] for r in report["detections"]]),
        ("Theo tài khoản", ["Tài khoản / Mã", "Tệp", "Byte", "Có phát hiện", "Lỗi"],
            [[f'{r["name"]}\n{r["id"]}', r["files"], r["bytes"], r["detected"], r["errors"]] for r in report["users"]]),
        ("Trích xuất", ["Phương thức", "Số tệp", "Trung bình (ms)"],
            [[r["label"], r["files"], r["average_ms"]] for r in report["methods"]]),
    ]


def csv_cell(value):
    text = str(value)
    # Names originate outside this application. Quoting alone does not stop Excel formulas.
    if text.lstrip().startswith(("=", "+", "-", "@")) or text.startswith(("\t", "\r", "\n")):
        return "'" + text
    return text


def export_csv(report):
    stream = StringIO(newline="")
    writer = csv.writer(stream)
    for row in [["MaySec · Thống kê quản trị"], ["Từ ngày", report["filters"]["from"], "Đến ngày", report["filters"]["to"]],
                ["Tạo lúc (UTC)", report["generated_at"]], ["Tài khoản", report["filters"]["owner_id"] or "Tất cả"],
                ["Phạm vi", report["filters"]["lifecycle"]], [report["scope_note"]]]:
        writer.writerow([csv_cell(c) for c in row])
    for title, headers, rows in report_sections(report):
        writer.writerow([])
        writer.writerow([title])
        writer.writerow(headers)
        writer.writerows([[csv_cell(c) for c in row] for row in rows])
    return ("\ufeff" + stream.getvalue()).encode("utf-8")


def export_pdf(report):
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

    fonts = Path(__file__).resolve().parents[1] / "assets" / "fonts"
    for name, filename in (("MaySec", "NotoSans-Regular.ttf"), ("MaySecBold", "NotoSans-Bold.ttf")):
        if name not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(name, str(fonts / filename)))
    text = ParagraphStyle("text", fontName="MaySec", fontSize=9, leading=14, textColor=colors.HexColor("#29324a"), alignment=TA_LEFT, wordWrap="CJK")
    heading = ParagraphStyle("heading", parent=text, fontName="MaySecBold", fontSize=13, leading=20, spaceBefore=14, spaceAfter=8, keepWithNext=True)
    def p(value, style=text):
        return Paragraph(escape(str(value)).replace("\n", "<br/>"), style)
    output = BytesIO()
    doc = SimpleDocTemplate(output, pagesize=A4, rightMargin=38, leftMargin=38, topMargin=38, bottomMargin=45,
                            title="MaySec · Thống kê quản trị", author="MaySec")
    selected = next((a["name"] for a in report["owners"] if a["id"] == report["filters"]["owner_id"]), "Tất cả người dùng")
    story = [p("MaySec · Thống kê quản trị", heading), p(f'{report["filters"]["from"]} đến {report["filters"]["to"]} · {selected}'),
             p(f'Phạm vi: { {"all": "Tất cả", "active": "Đang hoạt động", "trashed": "Thùng rác"}[report["filters"]["lifecycle"]]} · Tạo lúc (UTC): {report["generated_at"]}'),
             Spacer(1, 8), p(report["scope_note"])]
    for title, headers, rows in report_sections(report):
        story.append(p(title, heading))
        if not rows:
            story.append(p("Không có dữ liệu trong phạm vi đã chọn."))
            continue
        width = doc.width
        widths = [width * .44] + [width * .56 / (len(headers) - 1)] * (len(headers) - 1)
        table = Table([[p(c) for c in headers]] + [[p(c) for c in row] for row in rows], colWidths=widths, repeatRows=1, hAlign="LEFT")
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eee9fa")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#faf9fd")]),
            ("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("LINEBELOW", (0, 0), (-1, 0), .5, colors.HexColor("#cfc4ea")),
        ]))
        story.append(table)
    def footer(canvas, doc):
        canvas.setFont("MaySec", 8)
        canvas.setFillColor(colors.HexColor("#6b7084"))
        canvas.drawString(38, 23, "MaySec · Dữ liệu tổng hợp quản trị")
        canvas.drawRightString(A4[0] - 38, 23, f"Trang {doc.page}")
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return output.getvalue()

"""securedrive-scan-pii: quét dữ liệu nhạy cảm (CCCD, thẻ tín dụng) trong tệp mới tải lên.

Payload giữ bốn status và bổ sung owner/file/version cùng summary đầy đủ.
findings trong workflow chỉ giữ type, giới hạn số phần tử; location ở DB nội bộ.
- flagged   : findings không rỗng
- safe      : findings rỗng, đã đọc được nội dung và không thấy dữ liệu nhạy cảm
- unscanned : định dạng chưa hỗ trợ / vượt giới hạn quét (có reason)
- error     : không đọc được nội dung, hỏng, PDF có mật khẩu... (có reason)
`location` chỉ dùng nội bộ, không đưa vào thông báo. Không bao giờ lưu/trả giá trị gốc.

Quy tắc an toàn: tệp không đọc được hoặc chưa hỗ trợ KHÔNG BAO GIỜ được đánh dấu safe,
và mọi nhánh đều cập nhật bảng files + ghi audit log (khi DynamoDB được kích hoạt).

"""

import io
import logging
import os
import re
import time
from collections import Counter
from functools import lru_cache

import boto3
from botocore.exceptions import ClientError
from pipeline_common import (
    PipelineConflict, conditional_failure, put_audit, read_file, source_from_event,
    status_fields, summary, update_file, utc,
)

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# ---- Cấu hình (có thể ghi đè bằng biến môi trường của Lambda) ----
FILES_TABLE = os.environ.get("FILES_TABLE", "securedrive-files")
AUDIT_TABLE = os.environ.get("AUDIT_TABLE", "securedrive-audit-log")
# Integrated pipeline requires confirmed metadata/audit before notification.
STRICT_DB_WRITE = os.environ.get("STRICT_DB_WRITE", "true").lower() == "true"

MAX_SCAN_BYTES = int(os.environ.get("MAX_SCAN_BYTES", str(50 * 1024 * 1024)))
MAX_OCR_IMAGE_BYTES = 10 * 1024 * 1024  # giới hạn Textract đồng bộ
MAX_FINDINGS = int(os.environ.get("MAX_FINDINGS", "500"))  # tránh payload Step Functions quá 256KB
MIN_PDF_TEXT_CHARS = int(os.environ.get("MIN_PDF_TEXT_CHARS", "20"))
CREDIT_CARD_LUHN = os.environ.get("CREDIT_CARD_LUHN", "false").lower() == "true"

SAFE, FLAGGED, UNSCANNED, ERROR = "safe", "flagged", "unscanned", "error"

PATTERNS = {
    "CREDIT_CARD": re.compile(r"\b(?:\d{4}[ -]?){3}\d{4}\b"),  # thẻ 16 số
    "CCCD_VN": re.compile(r"\b0\d{2}[0-3]\d{2}\d{6}\b"),       # CCCD 12 số, bắt đầu bằng 0
}

TEXTRACT_UNREADABLE = {
    "UnsupportedDocumentException", "BadDocumentException", "InvalidS3ObjectException",
    "DocumentTooLargeException", "InvalidParameterException",
}


class Unsupported(Exception):
    """Định dạng/kích thước chưa hỗ trợ -> unscanned."""


class Unreadable(Exception):
    """Không đọc được nội dung -> error."""


class Incomplete(Unsupported):
    def __init__(self, reason, text=""):
        super().__init__(reason)
        self.text = text


@lru_cache(maxsize=None)
def _client(name):
    return boto3.client(name)


@lru_cache(maxsize=None)
def _table(name):
    return boto3.resource("dynamodb").Table(name)


# ---------------------------------------------------------------- đọc & nhận diện
def _detect_kind(data: bytes) -> str:
    """Nhận diện theo nội dung (magic bytes), không tin phần mở rộng/Content-Type."""
    head = data[:1024]
    if b"%PDF-" in head:
        return "pdf"
    if data.startswith((b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff", b"II*\x00", b"MM\x00*")):
        return "image"
    if data.startswith((b"\xff\xfe", b"\xfe\xff")) or b"\x00" not in data[:8192]:
        return "text"
    raise Unsupported("Định dạng tệp chưa được hỗ trợ quét")


def _decode_text(data: bytes) -> str:
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        try:
            return data.decode("utf-16")
        except UnicodeDecodeError:
            raise Unreadable("Không đọc được nội dung văn bản của tệp") from None
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        pass
    # Bảng mã cũ (cp1252...): chữ số vẫn đúng, nhưng phải trông giống văn bản thật.
    text = data.decode("latin-1")
    sample = text[:65536]
    printable = sum(ch.isprintable() or ch in "\r\n\t" for ch in sample)
    if sample and printable / len(sample) >= 0.95:
        return text
    raise Unreadable("Không đọc được nội dung văn bản của tệp")


def _pdf_text(data: bytes):
    """Trích văn bản từ PDF có chữ. None nếu thiếu thư viện hoặc PDF không có lớp chữ."""
    try:
        from pypdf import PdfReader  # cần đóng gói/layer; thiếu thì dùng Textract
    except ImportError:
        return None
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted and not reader.decrypt(""):
            raise Unreadable("PDF có mật khẩu, không đọc được")
        pages = list(reader.pages)
        texts = [(page.extract_text() or "") for page in pages]
        # Mixed PDFs must go through OCR instead of accepting only their text layer.
        if not pages or any(not text.strip() or bool(page.images) for page, text in zip(pages, texts)):
            return None
        text = "\n".join(texts)
    except Unreadable:
        raise
    except Exception:
        raise Unreadable("PDF bị hỏng hoặc không đọc được") from None
    return text if len(text.strip()) >= MIN_PDF_TEXT_CHARS else None


def _lines(blocks):
    return [b["Text"] for b in blocks if b.get("BlockType") == "LINE" and "Text" in b]


def _ocr_image(bucket, key, version=None) -> str:
    obj = {"Bucket": bucket, "Name": key}
    if version:
        obj["Version"] = version
    try:
        resp = _client("textract").detect_document_text(
            Document={"S3Object": obj})
    except ClientError as exc:
        if exc.response["Error"]["Code"] in TEXTRACT_UNREADABLE:
            raise Unreadable("Không đọc được nội dung ảnh (OCR)") from None
        raise
    text = "\n".join(_lines(resp.get("Blocks", [])))
    if not text.strip():
        raise Incomplete("ocr_no_text")
    return text


def _ocr_pdf(bucket, key, context, version=None) -> str:
    textract = _client("textract")
    obj = {"Bucket": bucket, "Name": key}
    if version:
        obj["Version"] = version
    try:
        job = textract.start_document_text_detection(
            DocumentLocation={"S3Object": obj})["JobId"]
    except ClientError as exc:
        if exc.response["Error"]["Code"] in TEXTRACT_UNREADABLE:
            raise Unreadable("Không đọc được nội dung PDF (OCR)") from None
        raise
    remaining_ms = context.get_remaining_time_in_millis() if hasattr(context, "get_remaining_time_in_millis") else 120_000
    deadline = time.monotonic() + max(remaining_ms / 1000 - 15, 5)
    while True:
        resp = textract.get_document_text_detection(JobId=job)
        status = resp["JobStatus"]
        if status in ("SUCCEEDED", "PARTIAL_SUCCESS"):
            break
        if status == "FAILED":
            raise Unreadable("OCR không đọc được toàn bộ nội dung PDF")
        if time.monotonic() > deadline:
            raise Unreadable("OCR PDF quá thời gian cho phép")
        time.sleep(2)
    partial = status == "PARTIAL_SUCCESS"
    blocks = list(resp.get("Blocks", []))
    expected_pages = resp.get("DocumentMetadata", {}).get("Pages")
    token = resp.get("NextToken")
    while token:
        if time.monotonic() > deadline:
            raise Incomplete("ocr_timeout", "\n".join(_lines(blocks)))
        resp = textract.get_document_text_detection(JobId=job, NextToken=token)
        blocks += resp.get("Blocks", [])
        partial = partial or resp.get("JobStatus") == "PARTIAL_SUCCESS"
        token = resp.get("NextToken")
    text = "\n".join(_lines(blocks))
    pages_with_text = {b.get("Page") for b in blocks if b.get("BlockType") == "LINE" and b.get("Text", "").strip()}
    if partial or not text.strip() or not expected_pages or len(pages_with_text) < expected_pages:
        raise Incomplete("ocr_incomplete", text)
    return text


def extract_text(bucket, key, context, version=None) -> str:
    args = {"Bucket": bucket, "Key": key}
    if version:
        args["VersionId"] = version
    size = _client("s3").head_object(**args)["ContentLength"]
    if size == 0:
        raise Unreadable("Tệp rỗng, không có nội dung để quét")
    if size > MAX_SCAN_BYTES:
        raise Unsupported("Tệp vượt giới hạn dung lượng có thể quét")
    body = _client("s3").get_object(**args)["Body"]
    try:
        data = body.read(MAX_SCAN_BYTES + 1)
    finally:
        body.close()
    if len(data) != size or len(data) > MAX_SCAN_BYTES:
        raise Unreadable("source_size_mismatch")
    kind = _detect_kind(data)
    if kind == "text":
        return _decode_text(data)
    if kind == "pdf":
        text = _pdf_text(data)
        return text if text is not None else _ocr_pdf(bucket, key, context, version)
    if size > MAX_OCR_IMAGE_BYTES:
        raise Unsupported("Ảnh vượt giới hạn dung lượng của OCR")
    return _ocr_image(bucket, key, version)


# ---------------------------------------------------------------- quét PII
def _luhn_ok(number: str) -> bool:
    digits = [int(c) for c in re.sub(r"\D", "", number)]
    total = 0
    for i, d in enumerate(reversed(digits)):
        if i % 2:
            d = d * 2 - 9 if d > 4 else d * 2
        total += d
    return total % 10 == 0


def find_pii(text: str):
    """Trả (findings, counts). findings chỉ gồm type + location, không chứa giá trị gốc."""
    findings, counts = [], Counter()
    for pii_type, pattern in PATTERNS.items():
        for m in pattern.finditer(text):
            if pii_type == "CREDIT_CARD" and CREDIT_CARD_LUHN and not _luhn_ok(m.group()):
                continue
            counts[pii_type] += 1
            if len(findings) < MAX_FINDINGS:
                findings.append({"type": pii_type, "location": f"Ký tự thứ {m.start()} đến {m.end()}"})
    return findings, dict(counts)


# ---------------------------------------------------------------- persistence / handler
def payload_from_record(row, source):
    scan = row.get("scan_result") or {}
    if not isinstance(scan, dict):
        scan = {}
    status = scan.get("status")
    status = status or ("flagged" if row["status"] in {"quarantined", "quarantine_delete_failed"} else row["status"])
    if status not in {SAFE, FLAGGED, UNSCANNED, ERROR}:
        raise PipelineConflict("scan_result_not_ready")
    return {"status": status, "owner_id": source["owner_id"], "file_id": source["file_id"],
            "source_version_id": source["version"], **summary(row),
            "findings": [{"type": f["type"]} for f in scan.get("findings", [])[:MAX_FINDINGS]],
            "reason": row.get("scan_reason", row.get("status_reason", "")),
            "scanned_at": row.get("scanned_at"), "extraction_complete": row.get("extraction_complete", True)}


def audit_scan(row, source):
    result = payload_from_record(row, source)
    put_audit(_table(AUDIT_TABLE), source, "scan_" + result["status"], result["status"],
              {**summary(row), "reason": result["reason"], "extraction_complete": result["extraction_complete"]},
              row["scanned_at"], execution_id=row.get("execution_id"))
    return result


def record_result(source, status, findings, counts, reason, ctx, *, complete=True):
    timestamp = utc()
    fields = {**status_fields(status, source["file_id"], timestamp),
              "scan_result": {"status": status, "findings": findings, "finding_counts": counts},
              "findings_count": sum(counts.values()), "finding_types": sorted(counts),
              "scanned_at": timestamp, "scan_reason": reason or "", "extraction_complete": complete}
    if source["version"]:
        fields["source_version_id"] = source["version"]
    if ctx.get("execution"):
        fields["execution_id"] = ctx["execution"]
    if status == FLAGGED:
        fields["quarantine_status"] = "pending"
    if reason:
        fields["status_reason"] = reason
    try:
        row = update_file(_table(FILES_TABLE), source, fields, statuses=["not_started", "scanning"],
                          remove=[] if reason else ["status_reason"], execution=ctx.get("execution"))
    except ClientError as exc:
        if not conditional_failure(exc):
            raise
        row = read_file(_table(FILES_TABLE), source)
        # Replay may repair missing audit, but never return a newly computed stale result.
        if row.get("status") in {"not_started", "scanning"}:
            raise PipelineConflict("scan_execution_conflict") from exc
    return audit_scan(row, source)


def lambda_handler(event, context):
    if not STRICT_DB_WRITE:
        raise ValueError("Integrated pipeline requires STRICT_DB_WRITE=true")
    source = source_from_event(event)
    if not source["version"]:
        raise PipelineConflict("source_version_required")
    ctx = event.get("ctx") or {}
    row = read_file(_table(FILES_TABLE), source)
    if row["status"] not in {"not_started", "scanning"}:
        return audit_scan(row, source)
    if event.get("operation") == "record_failure":
        return record_result(source, ERROR, [], {}, "scan_crashed", ctx, complete=False)
    fields = {**status_fields("scanning", source["file_id"]), "source_version_id": source["version"]}
    if ctx.get("execution"):
        fields["execution_id"] = ctx["execution"]
    update_file(_table(FILES_TABLE), source, fields, statuses=["not_started", "scanning"], execution=ctx.get("execution"))
    findings, counts, reason, complete = [], {}, None, True
    try:
        text = extract_text(source["bucket"], source["key"], context, source["version"])
        findings, counts = find_pii(text)
        status = FLAGGED if counts else SAFE
    except Incomplete as exc:
        findings, counts = find_pii(exc.text)
        status, reason, complete = (FLAGGED if counts else UNSCANNED), str(exc), False
    except Unsupported:
        status, reason, complete = UNSCANNED, "unsupported_type_or_size", False
    except Unreadable:
        status, reason, complete = ERROR, "unreadable_document", False
    except Exception:
        logger.exception("Scan failed for file_id=%s", source["file_id"])
        status, reason, complete = ERROR, "scan_failed", False
    return record_result(source, status, findings, counts, reason, ctx, complete=complete)

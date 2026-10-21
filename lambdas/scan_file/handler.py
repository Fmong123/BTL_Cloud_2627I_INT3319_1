"""securedrive-scan-pii: quét dữ liệu nhạy cảm (CCCD, thẻ tín dụng) trong tệp mới tải lên.

Payload trả về cho Step Functions (đúng 4 giá trị status, viết đúng chính tả):
    {"status": "flagged|safe|unscanned|error", "findings": [...], "reason": "..."}
- flagged   : findings không rỗng
- safe      : findings rỗng, đã đọc được nội dung và không thấy dữ liệu nhạy cảm
- unscanned : định dạng chưa hỗ trợ / vượt giới hạn quét (có reason)
- error     : không đọc được nội dung, hỏng, PDF có mật khẩu... (có reason)
`location` chỉ dùng nội bộ, không đưa vào thông báo. Không bao giờ lưu/trả giá trị gốc.

Quy tắc an toàn: tệp không đọc được hoặc chưa hỗ trợ KHÔNG BAO GIỜ được đánh dấu safe,
và mọi nhánh đều cập nhật bảng files + ghi audit_log (khi DynamoDB được kích hoạt).
"""

import io
import logging
import os
import re
import time
import urllib.parse
import uuid
from collections import Counter
from datetime import datetime, timezone
from functools import lru_cache

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# ---- Cấu hình (có thể ghi đè bằng biến môi trường của Lambda) ----
FILES_TABLE = os.environ.get("FILES_TABLE", "files")
AUDIT_TABLE = os.environ.get("AUDIT_TABLE", "audit_log")
FILES_PK = os.environ.get("FILES_PK", "file_id")
# Cho phép chạy mượt với Step Functions ngay cả khi nhánh Hạ tầng chưa tạo xong bảng DynamoDB
STRICT_DB_WRITE = os.environ.get("STRICT_DB_WRITE", "false").lower() == "true"

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
        text = "\n".join((page.extract_text() or "") for page in reader.pages)
    except Unreadable:
        raise
    except Exception:
        raise Unreadable("PDF bị hỏng hoặc không đọc được") from None
    return text if len(text.strip()) >= MIN_PDF_TEXT_CHARS else None


def _lines(blocks):
    return [b["Text"] for b in blocks if b.get("BlockType") == "LINE" and "Text" in b]


def _ocr_image(bucket, key) -> str:
    try:
        resp = _client("textract").detect_document_text(
            Document={"S3Object": {"Bucket": bucket, "Name": key}})
    except ClientError as exc:
        if exc.response["Error"]["Code"] in TEXTRACT_UNREADABLE:
            raise Unreadable("Không đọc được nội dung ảnh (OCR)") from None
        raise
    return "\n".join(_lines(resp["Blocks"]))


def _ocr_pdf(bucket, key, context) -> str:
    textract = _client("textract")
    try:
        job = textract.start_document_text_detection(
            DocumentLocation={"S3Object": {"Bucket": bucket, "Name": key}})["JobId"]
    except ClientError as exc:
        if exc.response["Error"]["Code"] in TEXTRACT_UNREADABLE:
            raise Unreadable("Không đọc được nội dung PDF (OCR)") from None
        raise
    remaining_ms = context.get_remaining_time_in_millis() if hasattr(context, "get_remaining_time_in_millis") else 120_000
    deadline = time.monotonic() + max(remaining_ms / 1000 - 15, 5)
    while True:
        resp = textract.get_document_text_detection(JobId=job)
        status = resp["JobStatus"]
        if status == "SUCCEEDED":
            break
        if status in ("FAILED", "PARTIAL_SUCCESS"):
            raise Unreadable("OCR không đọc được toàn bộ nội dung PDF")
        if time.monotonic() > deadline:
            raise Unreadable("OCR PDF quá thời gian cho phép")
        time.sleep(2)
    lines = _lines(resp["Blocks"])
    token = resp.get("NextToken")
    while token:
        resp = textract.get_document_text_detection(JobId=job, NextToken=token)
        lines += _lines(resp["Blocks"])
        token = resp.get("NextToken")
    return "\n".join(lines)


def extract_text(bucket, key, context) -> str:
    size = _client("s3").head_object(Bucket=bucket, Key=key)["ContentLength"]
    if size == 0:
        raise Unreadable("Tệp rỗng, không có nội dung để quét")
    if size > MAX_SCAN_BYTES:
        raise Unsupported("Tệp vượt giới hạn dung lượng có thể quét")
    data = _client("s3").get_object(Bucket=bucket, Key=key)["Body"].read()
    kind = _detect_kind(data)
    if kind == "text":
        return _decode_text(data)
    if kind == "pdf":
        text = _pdf_text(data)
        return text if text is not None else _ocr_pdf(bucket, key, context)
    if size > MAX_OCR_IMAGE_BYTES:
        raise Unsupported("Ảnh vượt giới hạn dung lượng của OCR")
    return _ocr_image(bucket, key)


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


# ---------------------------------------------------------------- ghi DynamoDB
def record_result(file_id, key, status, findings, counts, reason=None):
    """Cập nhật files + ghi audit_log. Không làm sập luồng Step Functions nếu bảng DB chưa tạo."""
    now = datetime.now(timezone.utc).isoformat()
    scan_result = {"findings": findings, "finding_counts": counts}
    names, values = {"#s": "status"}, {":s": status, ":r": scan_result, ":t": now}
    expr = "SET #s = :s, scan_result = :r, scanned_at = :t, updated_at = :t"
    if reason:
        expr += ", reason = :reason"
        values[":reason"] = reason
    else:
        expr += " REMOVE reason"

    try:
        _table(FILES_TABLE).update_item(
            Key={FILES_PK: file_id}, UpdateExpression=expr,
            ExpressionAttributeNames=names, ExpressionAttributeValues=values)

        detail = {"key": key, "finding_counts": counts}
        if reason:
            detail["reason"] = reason
        _table(AUDIT_TABLE).put_item(Item={
            "log_id": str(uuid.uuid4()), "file_id": file_id, "timestamp": now,
            "actor": "lambda:securedrive-scan-pii", "action": f"scan_{status}",
            "status": status, "detail": detail,
        })
    except Exception as exc:
        if STRICT_DB_WRITE:
            raise
        logger.warning("Bỏ qua ghi DynamoDB (bảng chưa tạo hoặc thiếu quyền IAM): %s", exc)


# ---------------------------------------------------------------- handler
def _payload(status, findings=None, reason=None):
    out = {"status": status, "findings": findings or []}
    if status in (UNSCANNED, ERROR):
        out["reason"] = reason or "Không rõ lý do"
    return out


def _parse_event(event):
    """Hỗ trợ sự kiện EventBridge (detail.bucket/object), S3 Records và dạng {"bucket","key"}."""
    if "Records" in event and event["Records"]:
        s3_info = event["Records"][0].get("s3", {})
        bucket = s3_info.get("bucket", {}).get("name")
        raw_key = s3_info.get("object", {}).get("key")
    else:
        detail = event.get("detail", event)
        bucket = detail["bucket"]["name"] if isinstance(detail.get("bucket"), dict) else detail["bucket"]
        raw_key = detail["object"]["key"] if isinstance(detail.get("object"), dict) else detail["key"]

    if not bucket or not raw_key:
        raise ValueError("Thiếu bucket hoặc key")

    key = urllib.parse.unquote_plus(raw_key)
    parts = [p for p in key.split("/") if p]
    # Quy ước chuẩn từ Backend: uploads/<user>/<file_id>/<tên-an-toàn> -> lấy parts[-2]
    # Hỗ trợ thêm trường hợp test trực tiếp trên S3 Console (uploads/file.txt) -> lấy parts[-1]
    file_id = parts[-2] if len(parts) >= 3 else parts[-1]
    return bucket, key, file_id


def lambda_handler(event, context):
    try:
        bucket, key, file_id = _parse_event(event)
    except (KeyError, TypeError, ValueError, AttributeError, IndexError):
        logger.error("Sự kiện đầu vào không hợp lệ")
        return _payload(ERROR, reason="Sự kiện đầu vào không hợp lệ")

    logger.info("Quét file_id=%s key=%s", file_id, key)
    findings, counts, reason = [], {}, None
    try:
        text = extract_text(bucket, key, context)
        findings, counts = find_pii(text)
        status = FLAGGED if counts else SAFE
    except Unsupported as exc:
        status, reason = UNSCANNED, str(exc)
    except Unreadable as exc:
        status, reason = ERROR, str(exc)
    except Exception:
        # Không đưa chi tiết SDK/đường dẫn nội bộ vào reason; chi tiết nằm ở CloudWatch.
        logger.exception("Lỗi không mong đợi khi quét file_id=%s", file_id)
        status, reason = ERROR, "Lỗi hệ thống khi quét tệp"

    record_result(file_id, key, status, findings, counts, reason)
    logger.info("Kết quả file_id=%s status=%s", file_id, status)
    return _payload(status, findings, reason)
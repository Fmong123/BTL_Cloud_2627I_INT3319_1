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
import hashlib
import logging
import os
import re
import time
import warnings
from collections import Counter
from functools import lru_cache

import boto3
from botocore.exceptions import ClientError, BotoCoreError
from botocore.config import Config
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

# Match backend upload admission: 100 MB = 100,000,000 bytes.
MAX_SCAN_BYTES = int(os.environ.get("MAX_SCAN_BYTES", "100000000"))
MAX_OCR_IMAGE_BYTES = 10 * 1024 * 1024  # giới hạn Textract đồng bộ
MAX_OCR_FRAMES = int(os.environ.get("MAX_OCR_FRAMES", "50"))
MAX_FINDINGS = int(os.environ.get("MAX_FINDINGS", "500"))  # tránh payload Step Functions quá 256KB
MIN_PDF_TEXT_CHARS = int(os.environ.get("MIN_PDF_TEXT_CHARS", "1"))
CREDIT_CARD_LUHN = os.environ.get("CREDIT_CARD_LUHN", "false").lower() == "true"

SAFE, FLAGGED, UNSCANNED, ERROR = "safe", "flagged", "unscanned", "error"

PATTERNS = {
    "CREDIT_CARD": re.compile(r"\b(?:\d{4}[ -]?){3}\d{4}\b"),  # thẻ 16 số
    "CCCD_VN": re.compile(r"\b0\d{2}[0-3]\d{2}\d{6}\b"),       # CCCD 12 số, bắt đầu bằng 0
}

class Unsupported(Exception):
    """Định dạng/kích thước chưa hỗ trợ -> unscanned."""


class Unreadable(Exception):
    """Không đọc được nội dung -> error."""


class Incomplete(Unsupported):
    def __init__(self, reason, text="", metadata=None):
        super().__init__(reason)
        self.text = text
        self.metadata = metadata or {}


class ExtractedText(str):
    """Text stays local; only bounded extraction statistics are persisted."""
    def __new__(cls, value, **metadata):
        result = super().__new__(cls, value)
        result.metadata = metadata
        return result


@lru_cache(maxsize=None)
def _client(name):
    if name == "textract":
        return boto3.client(name, config=Config(connect_timeout=3, read_timeout=10,
                                               retries={"total_max_attempts": 1}))
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
    if data.startswith((b"GIF87a", b"GIF89a")) or data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image"
    if data.startswith((b"\xff\xfe", b"\xfe\xff")) or b"\x00" not in data[:8192]:
        return "text"
    raise Unsupported("Định dạng tệp chưa được hỗ trợ quét")


def _decode_text(data: bytes) -> str:
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        try:
            return data.decode("utf-16")
        except UnicodeDecodeError:
            raise Unreadable("text_decode_failed") from None
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
    raise Unreadable("text_decode_failed")


def _pdf_text(data: bytes):
    """Read every text page; OCR is needed for scanned/mixed PDFs."""
    try:
        from pypdf import PdfReader
        from pypdf.errors import DependencyError
    except ImportError:
        raise Unsupported("pdf_parser_unavailable") from None
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted and not reader.decrypt(""):
            raise Unreadable("pdf_password_protected")
        pages = list(reader.pages)
        if not pages:
            raise Unreadable("pdf_invalid")
    except DependencyError:
        raise Unsupported("pdf_crypto_unavailable") from None
    except Unreadable:
        raise
    except Exception:
        raise Unreadable("pdf_invalid") from None
    try:
        texts = [(page.extract_text() or "") for page in pages]
        # Mixed PDFs must go through OCR instead of accepting only their text layer.
        if not pages or any(not text.strip() or bool(page.images) for page, text in zip(pages, texts)):
            return None
        text = "\n".join(texts)
    except Exception:
        # Valid PDFs with unsupported text encodings can still be read by OCR.
        logger.warning("PDF text layer could not be extracted; falling back to OCR")
        return None
    return ExtractedText(text, total_pages=len(pages), extracted_pages=len(pages)) if len(text.strip()) >= MIN_PDF_TEXT_CHARS else None


def _lines(blocks):
    return [b["Text"] for b in blocks if b.get("BlockType") == "LINE" and "Text" in b]


def _ocr_pages(blocks, *, include_blank=False):
    return {b["Page"] for b in blocks if type(b.get("Page")) is int and b["Page"] > 0
            and ((b.get("BlockType") == "LINE" and b.get("Text", "").strip())
                 or (include_blank and b.get("BlockType") == "PAGE"))}


def _ocr_error(exc):
    code = exc.response.get("Error", {}).get("Code", "")
    logger.warning("Textract request failed (%s)", code)
    if code in {"ThrottlingException", "ProvisionedThroughputExceededException", "LimitExceededException"}:
        raise Incomplete("ocr_throttled") from exc
    if code == "DocumentTooLargeException":
        raise Unsupported("ocr_document_too_large") from exc
    reason = {"AccessDeniedException": "ocr_access_denied", "InvalidS3ObjectException": "ocr_source_unavailable",
              "InvalidKMSKeyException": "ocr_kms_unavailable", "InvalidParameterException": "ocr_invalid_request"}.get(code)
    if reason or code in {"UnsupportedDocumentException", "BadDocumentException"}:
        raise Unreadable(reason or "ocr_document_unreadable") from exc
    raise exc


def _ocr_image(bucket, key, version=None, *, data=None) -> str:
    if bucket is None and (data is None or len(data) > 5_000_000):
        raise Unsupported("image_too_large")
    obj = {"Bucket": bucket, "Name": key}
    if version:
        obj["Version"] = version
    try:
        # These bytes were already read from the pinned S3 version. Small
        # PNG/JPEG images need no second S3 read by Textract.
        document = {"Bytes": data} if data is not None and len(data) <= 5_000_000 else {"S3Object": obj}
        resp = _client("textract").detect_document_text(Document=document)
    except ClientError as exc:
        _ocr_error(exc)
    except BotoCoreError as exc:
        raise Incomplete("ocr_unavailable") from exc
    text = "\n".join(_lines(resp.get("Blocks", [])))
    pages = resp.get("DocumentMetadata", {}).get("Pages")
    if (type(pages) is not int or pages != 1 or resp.get("Warnings") or resp.get("NextToken")
            or resp.get("JobStatus") not in {None, "SUCCEEDED"}):
        raise Incomplete("ocr_incomplete", text, {"total_pages": pages, "extracted_pages": 1})
    # Successful OCR of the whole image may legitimately contain no text
    # (e.g. a landscape photo). The detector then reports no PII.
    return ExtractedText(text, total_pages=1, extracted_pages=1)


def _ocr_frames(data, context):
    """Decode formats Textract cannot read; scan every frame without S3 writes."""
    try:
        from PIL import Image
    except ImportError:
        raise Unsupported("image_decoder_unavailable") from None
    texts, read_frames, total_frames = [], 0, 0
    def metadata():
        return {"total_pages": total_frames, "extracted_pages": read_frames}
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                total_frames = getattr(image, "n_frames", 1)
                for index in range(min(total_frames, MAX_OCR_FRAMES)):
                    if hasattr(context, "get_remaining_time_in_millis") and context.get_remaining_time_in_millis() <= 15_000:
                        raise Incomplete("ocr_timeout", "\n".join(texts), metadata())
                    image.seek(index)
                    rgba = image.convert("RGBA")
                    # Preserve dimensions and composite transparency onto white;
                    # downscaling could hide sensitive text.
                    rgb = Image.new("RGB", rgba.size, "white")
                    rgb.paste(rgba, mask=rgba.getchannel("A"))
                    output = io.BytesIO()
                    rgb.save(output, format="PNG")
                    try:
                        text = _ocr_image(None, None, data=output.getvalue())
                    except Incomplete as exc:
                        if exc.text:
                            texts.append(exc.text)
                        raise Incomplete(str(exc), "\n".join(texts), metadata()) from exc
                    except (Unreadable, Unsupported) as exc:
                        if texts:
                            raise Incomplete(str(exc), "\n".join(texts), metadata()) from exc
                        raise
                    texts.append(text)
                    read_frames += 1
    except (OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        if texts:
            raise Incomplete("image_invalid", "\n".join(texts), metadata()) from exc
        raise Unreadable("image_invalid") from exc
    if read_frames != total_frames:
        raise Incomplete("ocr_incomplete", "\n".join(texts), metadata())
    return ExtractedText("\n".join(texts), **metadata())


def _ocr_pdf(bucket, key, context, version=None, *, allow_no_text=False) -> str:
    textract = _client("textract")
    obj = {"Bucket": bucket, "Name": key}
    if version:
        obj["Version"] = version
    remaining_ms = context.get_remaining_time_in_millis() if hasattr(context, "get_remaining_time_in_millis") else 120_000
    deadline = time.monotonic() + max(remaining_ms / 1000 - 15, 0)
    if time.monotonic() >= deadline:
        raise Incomplete("ocr_timeout")
    try:
        job = textract.start_document_text_detection(
            DocumentLocation={"S3Object": obj})["JobId"]
    except ClientError as exc:
        _ocr_error(exc)
    except BotoCoreError as exc:
        raise Incomplete("ocr_unavailable") from exc
    def fetch(**args):
        if time.monotonic() >= deadline:
            raise Incomplete("ocr_timeout")
        try:
            return textract.get_document_text_detection(JobId=job, **args)
        except ClientError as exc:
            _ocr_error(exc)
        except BotoCoreError as exc:
            raise Incomplete("ocr_unavailable") from exc
    while True:
        resp = fetch()
        status = resp["JobStatus"]
        if status in ("SUCCEEDED", "PARTIAL_SUCCESS"):
            break
        if status == "FAILED":
            logger.warning("Textract document job failed, job_id=%s", job)
            raise Unreadable("ocr_failed")
        if time.monotonic() > deadline:
            raise Incomplete("ocr_timeout")
        time.sleep(2)
    partial = status == "PARTIAL_SUCCESS" or bool(resp.get("Warnings"))
    blocks = list(resp.get("Blocks", []))
    expected_pages = resp.get("DocumentMetadata", {}).get("Pages")
    token = resp.get("NextToken")
    seen_tokens = set()
    while token:
        if time.monotonic() > deadline:
            raise Incomplete("ocr_timeout", "\n".join(_lines(blocks)), {"total_pages": expected_pages,
                "extracted_pages": len(_ocr_pages(blocks, include_blank=allow_no_text))})
        if token in seen_tokens:
            raise Incomplete("ocr_incomplete", "\n".join(_lines(blocks)))
        seen_tokens.add(token)
        try:
            resp = fetch(NextToken=token)
        except (Unreadable, Unsupported) as exc:
            metadata = {"total_pages": expected_pages,
                "extracted_pages": len(_ocr_pages(blocks, include_blank=allow_no_text))}
            raise Incomplete(str(exc), "\n".join(_lines(blocks)), metadata) from exc
        blocks += resp.get("Blocks", [])
        partial = partial or resp.get("JobStatus") != "SUCCEEDED" or bool(resp.get("Warnings"))
        token = resp.get("NextToken")
    text = "\n".join(_lines(blocks))
    read_pages = _ocr_pages(blocks, include_blank=allow_no_text)
    if (partial or (not allow_no_text and not text.strip()) or type(expected_pages) is not int or expected_pages < 1
            or read_pages != set(range(1, expected_pages + 1))):
        raise Incomplete("ocr_incomplete", text, {"total_pages": expected_pages, "extracted_pages": len(read_pages)})
    return ExtractedText(text, total_pages=expected_pages, extracted_pages=len(read_pages))


def extract_text(bucket, key, context, version=None) -> str:
    trace = {}
    started = time.monotonic()
    try:
        result = _extract_text(bucket, key, context, version, trace)
        return ExtractedText(result, **trace, **getattr(result, "metadata", {}),
                             extraction_duration_ms=max(0, int((time.monotonic() - started) * 1000)))
    except Exception as exc:
        exc.metadata = {**trace, **getattr(exc, "metadata", {}),
                        "extraction_duration_ms": max(0, int((time.monotonic() - started) * 1000))}
        raise


def _extract_text(bucket, key, context, version, trace) -> str:
    args = {"Bucket": bucket, "Key": key}
    if version:
        args["VersionId"] = version
    size = _client("s3").head_object(**args)["ContentLength"]
    if size == 0:
        raise Unreadable("empty_file")
    if size > MAX_SCAN_BYTES:
        raise Unsupported("file_too_large")
    body = _client("s3").get_object(**args)["Body"]
    try:
        data = body.read(MAX_SCAN_BYTES + 1)
    finally:
        body.close()
    if len(data) != size or len(data) > MAX_SCAN_BYTES:
        raise Unreadable("source_size_mismatch")
    kind = _detect_kind(data)
    trace["detected_format"] = kind
    if kind == "text":
        trace["extraction_method"] = "direct_text"
        return _decode_text(data)
    if kind == "pdf":
        trace["extraction_method"] = "pdf_text"
        text = _pdf_text(data)
        if text is not None:
            return text
        trace["extraction_method"] = "textract_pdf"
        return _ocr_pdf(bucket, key, context, version)
    trace["detected_format"] = ("png" if data.startswith(b"\x89PNG") else "jpeg" if data.startswith(b"\xff\xd8")
                                else "gif" if data.startswith(b"GIF") else "webp" if data.startswith(b"RIFF") else "tiff")
    trace["extraction_method"] = "textract_image"
    if trace["detected_format"] == "tiff":
        # Synchronous Textract only supports one TIFF page. Use the paginated
        # document API so later pages cannot silently escape the scan.
        return _ocr_pdf(bucket, key, context, version, allow_no_text=True)
    if size > MAX_OCR_IMAGE_BYTES:
        raise Unsupported("image_too_large")
    if trace["detected_format"] in {"gif", "webp"}:
        return _ocr_frames(data, context)
    return _ocr_image(bucket, key, version, data=data)


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


def processing_record(row, source):
    identity = "|".join(str(v or "") for v in (source["file_id"], source["version"], row.get("execution_id"), row["scanned_at"]))
    return {"owner_id": f"!quota!{source['owner_id']}",
        "file_id": "billing-scan-" + hashlib.sha256(identity.encode()).hexdigest(),
        "occurred_at": row["scanned_at"], "scan_status": (row.get("scan_result") or {}).get("status", row["status"]),
        "extraction_method": row.get("extraction_method", "unknown"),
        "extracted_pages": row.get("extracted_pages", 0)}


def audit_scan(row, source):
    result = payload_from_record(row, source)
    record = row.get("billing_processing_record") or processing_record(row, source)
    details = {**summary(row), "reason": result["reason"], "extraction_complete": result["extraction_complete"]}
    # Preserve the exact payload of pre-upgrade audit events on replay.
    if row.get("billing_processing_record"):
        details["billing_processing"] = record
    put_audit(_table(AUDIT_TABLE), source, "scan_" + result["status"], result["status"], details,
              row["scanned_at"], execution_id=row.get("execution_id"))
    try:
        _table(FILES_TABLE).put_item(Item=record, ConditionExpression="attribute_not_exists(file_id)")
    except (ClientError, BotoCoreError) as exc:
        if not conditional_failure(exc):
            # The durable audit contains the event; the backend repairs it later.
            # Usage statistics must never prevent quarantine or notification.
            logger.warning("Processing usage deferred for file_id=%s", source["file_id"])
    from pipeline_common import put_notification
    put_notification(_table(FILES_TABLE), source, row, "scan_" + result["status"], result["status"],
                     row["scanned_at"], execution_id=row.get("execution_id"))
    return result


def record_result(source, status, findings, counts, reason, ctx, *, complete=True, extraction=None):
    timestamp = utc()
    fields = {**status_fields(status, source["file_id"], timestamp),
              "scan_result": {"status": status, "findings": findings, "finding_counts": counts},
              "findings_count": sum(counts.values()), "finding_types": sorted(counts),
              "scanned_at": timestamp, "scan_reason": reason or "", "extraction_complete": complete}
    for name, value in (extraction or {}).items():
        if name in {"detected_format", "extraction_method"} and isinstance(value, str):
            fields[name] = value
        elif name in {"total_pages", "extracted_pages", "extraction_duration_ms"} and type(value) is int and value >= 0:
            fields[name] = value
    if source["version"]:
        fields["source_version_id"] = source["version"]
    if ctx.get("execution"):
        fields["execution_id"] = ctx["execution"]
    if status == FLAGGED:
        fields["quarantine_status"] = "pending"
    if reason:
        fields["status_reason"] = reason
    fields["billing_processing_record"] = processing_record(fields, source)
    fields["billing_usage_pending"] = True
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
    from pipeline_common import verify_rescan_execution
    verify_rescan_execution(row, event)
    if event.get("recovery") or row.get("pipeline_busy"):
        raise PipelineConflict("recovery_cannot_scan")
    if row["status"] not in {"not_started", "scanning"}:
        return audit_scan(row, source)
    if event.get("operation") == "record_failure":
        return record_result(source, ERROR, [], {}, "scan_crashed", ctx, complete=False)
    started_at = row.get("scan_started_at") or utc()
    fields = {**status_fields("scanning", source["file_id"]), "source_version_id": source["version"],
              "scan_started_at": started_at}
    if ctx.get("execution"):
        fields["execution_id"] = ctx["execution"]
    update_file(_table(FILES_TABLE), source, fields, statuses=["not_started", "scanning"], execution=ctx.get("execution"))
    findings, counts, reason, complete, extraction = [], {}, None, True, {}
    try:
        text = extract_text(source["bucket"], source["key"], context, source["version"])
        extraction = getattr(text, "metadata", {})
        findings, counts = find_pii(text)
        status = FLAGGED if counts else SAFE
    except Incomplete as exc:
        extraction = exc.metadata
        findings, counts = find_pii(exc.text)
        status, reason, complete = (FLAGGED if counts else UNSCANNED), str(exc), False
    except Unsupported as exc:
        extraction = getattr(exc, "metadata", {})
        status, reason, complete = UNSCANNED, str(exc) if str(exc) in {"file_too_large", "image_too_large", "pdf_parser_unavailable", "pdf_crypto_unavailable", "image_decoder_unavailable", "ocr_document_too_large"} else "unsupported_type_or_size", False
    except Unreadable as exc:
        extraction = getattr(exc, "metadata", {})
        status, reason, complete = ERROR, str(exc) if str(exc) in {"empty_file", "source_size_mismatch", "text_decode_failed", "pdf_password_protected", "pdf_invalid", "image_invalid", "ocr_document_unreadable", "ocr_failed", "ocr_access_denied", "ocr_source_unavailable", "ocr_kms_unavailable", "ocr_invalid_request"} else "unreadable_document", False
    except Exception as exc:
        extraction = getattr(exc, "metadata", {})
        logger.exception("Scan failed for file_id=%s", source["file_id"])
        status, reason, complete = ERROR, "scan_failed", False
    return record_result(source, status, findings, counts, reason, ctx, complete=complete, extraction=extraction)

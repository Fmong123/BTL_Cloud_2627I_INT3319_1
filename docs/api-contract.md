# Hợp đồng HTTP MâySec

Cập nhật 31/10/2026. Schema chính xác của API đang chạy nằm tại /openapi.json và Swagger /docs. Owner hiện lấy từ dependency dev-user; chưa có xác thực nhiều tài khoản.

## Endpoint

| Method | Đường dẫn | Hành vi |
| --- | --- | --- |
| GET | /health | Cấu hình và capabilities; không kiểm quyền AWS end-to-end |
| POST | /upload | Multipart trường file, một tệp/request; 201 khi lưu và bookkeeping xác nhận |
| GET | /storage/usage | limit_bytes, used_bytes, reserved_bytes, available_bytes |
| GET | /files | limit 1–100, cursor; area=active (mặc định), trash hoặc all |
| GET | /files/{id}/status | Trạng thái upload/quét, summary và revision chỉnh sửa; chỉ đọc |
| GET | /files/{id}/scan-report | Báo cáo tổng hợp; không trả giá trị PII/OCR |
| POST | /files/{id}/rescan | JSON request_id UUID; 202, workflow version-pinned |
| GET | /files/{id}/content | mode=preview hoặc download; mặc định download |
| PATCH | /files/{id}/preferences | JSON starred boolean |
| PATCH | /files/{id}/name | JSON name; chỉ đổi tên hiển thị |
| POST | /files/{id}/trash | Xóa mềm, giữ 30 ngày |
| POST | /files/{id}/restore | Khôi phục khi còn hạn, chưa bắt đầu xóa |
| DELETE | /files/{id} | Xóa vĩnh viễn tệp trong rác/chờ xóa |
| GET | /upload-history | Snapshot tệp đã xóa, phân trang limit/cursor |
| GET / POST | /notifications | Đọc phân trang hoặc lưu sự kiện/thao tác đã đọc |

Danh sách trả items/next_cursor. Thứ tự backend theo file_id; frontend đọc đủ trang rồi tìm/lọc/sắp xếp trên metadata. Cursor được kiểm partition/owner; không phải token xác thực. Không có GET /; GET /upload trả 405.

## Upload và dung lượng

- Mỗi tệp tối đa 100.000.000 byte = 100 MB; cấu hình thấp hơn có thể giảm trần. Middleware cho thêm 1 MiB overhead multipart.
- Quota 1.000.000.000 byte/owner. used_bytes tính uploaded kể cả trashed/deleting; uploading/unknown giữ chỗ trong reserved_bytes; failed không tính.
- Không cộng partition quota/history/notifications vào dung lượng nội dung. Bản cách ly tính một lần; quota logic không phải tổng byte vật lý của mọi version S3.
- S3 bắt buộc metadata DynamoDB để kiểm quota; Local có kiểm quota đĩa kể cả metadata disabled.
- Key: uploads/{owner_id}/{file_id}/{safe_filename}. Trả id, key, storage, original_name, size_bytes, content_type và scan_status; metadata bật có thêm trạng thái/revision.
- Lỗi sau khi đã có ID có thể kèm X-File-Id/X-File-Key để đối soát. Timeout/hủy không chứng minh server chưa ghi; upload mới chưa có idempotency.

## Trạng thái và báo cáo

upload_state: uploading, uploaded, failed, unknown. scan_status: not_started, scanning, safe, flagged, quarantined, quarantine_delete_failed, unscanned, error.

Upload và scan độc lập. Copy cách ly lỗi giữ flagged; xóa nguồn lỗi là quarantine_delete_failed; chỉ hoàn tất mới quarantined. Mọi Lambda giữ guard execution và trạng thái lifecycle.

Báo cáo có findings_count, finding_types, finding_counts (type/count), counts_complete, extraction_complete, scanned_at, scan_reason và dữ liệu lượt rescan. Metadata cũ thiếu breakdown không được coi là đã có thống kê đủ. Không trả findings gốc, OCR hoặc vị trí nhạy cảm nội bộ.

Rescan dùng request_id UUID ổn định khi xác nhận lại lượt pending/unknown. Chỉ nhận uploaded + safe/error/unscanned/not_started và lifecycle active; cooldown 60 giây cho lượt mới. ARN phải là workflow STANDARD không alias/version ở ap-southeast-2. API không tự giải phóng cách ly hoặc tiếp quản lượt đang quét không rõ kết quả.

## Đọc nội dung

Cần active + uploaded + safe và storage tương ứng. Preview: PNG/JPEG/GIF/WebP tối đa 10 MB; PDF 20 MB; TXT/CSV/JSON UTF-8 1 MB. Download tối đa 100 MB.

Web gửi Accept: application/x-ndjson để nhận khung metadata/data/end, data là base64 từng đoạn. Trình duyệt dựng blob và mở viewer/Save As. Client khác nhận byte trực tiếp với Content-Disposition phù hợp. Response no-store/nosniff; không dùng key như URL tải hoặc trả presigned URL cho browser.

MIME gốc dùng cho kiểm tra nội dung; nhãn PNG/PDF… là cách trình bày. Đổi tên không đổi MIME hoặc object key.

## Vòng đời và activity

lifecycle_state: active, trashed, deleting, purged. Đổi tên và vòng đời có revision riêng, không ghi đè revision scan. Trạng thái purged có xác nhận trong lịch sử là kết quả cuối, không hồi sinh bởi poll/list cũ.

Xóa vĩnh viễn xóa mọi version/delete marker thuộc prefix tệp ở Upload/Quarantine, rồi transaction lưu snapshot lịch sử và xóa metadata sống. Lỗi một phần giữ deleting và quota; retry được. DELETE lặp lại sau thành công có snapshot purged vẫn xác nhận deleted=true. ID không hợp lệ trả 400.

Notifications lưu id, kind, title, message, tone, file_id tùy chọn, created_at và read. read chỉ chuyển sang true. Web ghi các sự kiện đã quan sát; đây không phải push nền hoặc audit log đầy đủ.

## Lỗi

| HTTP | Trường hợp điển hình |
| --- | --- |
| 400 / 422 | ID/cursor/tên không hợp lệ hoặc payload sai schema |
| 404 | Không có tệp/nội dung của owner hiện tại |
| 409 | Trạng thái không cho phép, hết hạn restore hoặc tranh chấp |
| 413 | Vượt giới hạn byte hoặc quota |
| 415 | Không hỗ trợ preview/UTF-8 |
| 429 | Quota đang khóa hoặc cooldown quét lại |
| 502 | Chưa xác nhận lưu/đọc/xóa nội dung |
| 503 | Thiếu cấu hình/quyền, metadata sai hoặc dịch vụ chưa sẵn sàng |

Lỗi ứng dụng trả JSON detail. capabilities chỉ báo readiness cấu hình/client. Backend dùng credentials chain của Boto3; frontend không giữ quyền AWS. CORS không thay cho xác thực.

Kiểm thử hiện hành: chạy pytest trong backend và npm test/build/test:ui trong frontend. Cài/chạy theo [api-guide.md](api-guide.md); cập nhật AWS theo [handoff](AWS-HANDOFF-QUICKSTART-2026-10-31.md).

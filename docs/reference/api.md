# Hợp đồng HTTP

Nguồn: [routers](../../backend/app/routers), [schema tệp](../../backend/app/schemas/file.py), [schema auth](../../backend/app/schemas/auth.py) và [main.py](../../backend/app/main.py). Schema chính xác của tiến trình đang chạy nằm tại `/openapi.json`, Swagger `/docs`.

Các đường dẫn dưới là route FastAPI. Proxy có thể thêm prefix /api; trang frontend dùng hash riêng, không phải endpoint backend. Ký hiệu `{id}` là file_id/folder_id; `{sub}` là owner_id trong router tài khoản.

## Xác thực và quy ước

- API dữ liệu cần Bearer token; Local có thể dùng auth=dev. Owner lấy từ danh tính đã xác minh. [Chính sách quyền](../policies/access-control.md) áp dụng cả gọi trực tiếp.
- /health và /auth/config công khai. Hai route demo chỉ hoạt động khi bật cờ trình diễn.
- Danh sách phân trang thường trả items/next_cursor; đọc tới next_cursor=null. Cursor gắn owner/bộ lọc/phạm vi, không thay token. Đổi scope phải đọc lại từ đầu.
- Nhiều trang không phải snapshot giao dịch toàn kho. Health báo cấu hình/client/capabilities, không kiểm IAM end-to-end.
- Không có GET /; GET /upload trả 405. Lỗi ứng dụng trả JSON detail.

## Auth và cấu hình

| Method | Đường dẫn | Payload / kết quả |
| --- | --- | --- |
| GET | /health | Storage, metadata, auth, giới hạn và capabilities |
| GET | /me | ID/vai trò; đồng bộ hồ sơ khi kết nối |
| GET | /auth/config | auth_mode, demo_enabled; không secret |
| GET | /auth/demo/accounts | Directory Cognito và đồng bộ users khi demo bật |
| POST | /auth/demo/login | JSON account_id; phiên demo có chữ ký |

## Tệp cá nhân

| Method | Đường dẫn | Payload / kết quả |
| --- | --- | --- |
| POST | /upload | Multipart file, folder_id tùy chọn; một tệp/request; 201 khi lưu/bookkeeping xác nhận |
| GET | /storage/usage | limit_bytes, used_bytes, reserved_bytes, available_bytes |
| GET | /files | limit 1–100, cursor, area=active/trash/all; mặc định active |
| GET | /files/{id}/status | Upload/quét/lifecycle và timestamp chỉnh sửa; chỉ đọc |
| GET | /files/{id}/scan-report | Báo cáo tổng hợp, không OCR/PII nguyên bản |
| POST | /files/{id}/rescan | request_id UUID; 202, giữ UUID khi xác nhận pending/unknown |
| PATCH | /files/{id}/preferences | starred boolean nghiêm ngặt; không nhận thuộc tính thừa |
| PATCH | /files/{id}/name | name, tối đa 255 ký tự trước/qua validation tên |
| GET | /files/{id}/content | mode=preview/download; mặc định download |
| GET | /files/{id}/history | limit 1–100, cursor; audit đã lọc |
| POST | /files/{id}/trash | Xóa mềm theo chính sách 30 ngày |
| POST | /files/{id}/restore | Khôi phục Thùng rác khi đủ điều kiện |
| DELETE | /files/{id} | Purge từ rác/đang xóa; trả id/deleted |
| GET | /files/{id}/quarantine-review | review của version cách ly hiện tại hoặc null |
| POST | /files/{id}/quarantine-review | reason 1–500 ký tự; tạo yêu cầu xem xét |
| POST | /files/{id}/compression-request/complete | Owner xác nhận đã xử lý yêu cầu nén; không nén byte trên server |
| GET | /upload-history | Snapshot tệp purged, limit/cursor |

Danh sách backend theo file_id; frontend đọc đủ trang rồi lọc/sắp xếp metadata. Upload trả id/key/storage/original_name/size_bytes/content_type/scan_status; metadata bật thêm upload state/thời điểm. Key uploads/{owner}/{file}/{safe_filename}. Lỗi sau khi có ID có thể có X-File-Id/X-File-Key; upload mới chưa có idempotency, timeout không chứng minh chưa ghi. Giới hạn/quota theo [chính sách](../policies/storage-quota.md).

## Trạng thái, báo cáo và nội dung

| Trường | Giá trị |
| --- | --- |
| upload_state | uploading, uploaded, failed, unknown |
| scan_status API | not_started, scanning, safe, flagged, quarantined, quarantine_delete_failed, unscanned, error, restored |
| lifecycle_state | active, trashed, deleting, purged |
| rescan_dispatch | pending, started, unknown, failed hoặc null |

Restored là ánh xạ từ quyết định quarantine_review gắn đúng version, không phải scanner xác nhận safe. Trạng thái upload/quét/vòng đời độc lập. Quy tắc [quét](../policies/scanning.md), [vòng đời](../policies/file-lifecycle.md), [quyền đọc](../policies/access-control.md).

Báo cáo gồm findings_count, finding_types, finding_counts (type/count), counts_complete, extraction_complete, scan_reason, thời điểm và rescan_request_id/rescan_dispatch. Thống kê trích xuất gồm detected_format=text/pdf/png/jpeg/tiff/gif/webp, extraction_method=direct_text/pdf_text/textract_image/textract_pdf, extracted_pages, total_pages, extraction_duration_ms; thiếu dữ liệu trả null. GIF/WebP đếm khung. Không suy thống kê từ đuôi tệp/safe hoặc trả OCR/findings gốc.

Owner đọc khi active + uploaded + safe/restored. Preview PNG/JPEG/GIF/WebP ≤10 MB, PDF ≤20 MB, TXT/CSV/JSON UTF-8 ≤1 MB; download ≤100 MB. MIME gốc dùng kiểm nội dung; đổi tên không đổi key/MIME.

Browser gửi Accept: application/x-ndjson, nhận metadata/data/end; data base64 từng đoạn. Client khác nhận byte với Content-Disposition phù hợp. Response no-store/nosniff; không trả presigned URL. Đọc restored dùng đúng version cách ly đã xác minh.

## Thư mục

| Method | Đường dẫn | Payload / kết quả |
| --- | --- | --- |
| GET | /folders | Toàn bộ thư mục owner gồm rác; items/next_cursor=null |
| POST | /folders | name, parent_id UUID/null tùy chọn; 201 |
| PATCH | /folders/{id} | name |
| POST | /folders/{id}/move | parent_id UUID/null, bắt buộc có trường |
| POST | /folders/move-files | file_ids UUID[1..50], folder_id UUID/null |
| POST | /folders/{id}/trash | Trash nhóm active, lưu trash_root_id |
| POST | /folders/{id}/restore | Restore nhóm đủ điều kiện |
| DELETE | /folders/{id} | Purge nội dung trước metadata; retry được |

Folder có id/name/parent_id/lifecycle_state/trashed_at/trash_expires_at/trash_root_id/purging. Tên tối đa 120 ký tự. File list/status thêm folder_id/folder_updated_at/trash_root_id; admin detail có folder_path. Revision nội bộ không trả thành thư mục. Quy tắc cây và giới hạn giao dịch tại [vòng đời](../policies/file-lifecycle.md).

## Quản trị tệp và vận hành

Tất cả admin route cần require_admin và phạm vi đích user trong pool; kiểm nhóm actor mới ở directory tùy luồng như [chính sách truy cập](../policies/access-control.md). owner_id UUID bắt buộc cho route /admin/files/{id} và các route con.

| Method | Đường dẫn | Payload / kết quả |
| --- | --- | --- |
| GET | /admin/quarantine | limit/cursor, owner_id, status, q, updated_from/updated_before |
| GET | /admin/overview | Tổng hợp phân trang counts/users/next_cursor, không trả nội dung tệp |
| GET | /admin/files/{id} | file, owner_name, can_read, report, review/path/pipeline |
| GET | /admin/files/{id}/history | limit/cursor; sự kiện đã lọc, tên tác nhân theo phạm vi |
| GET | /admin/files/{id}/content | Đúng bản cách ly, audit trước byte |
| GET | /admin/files/{id}/pipeline | Snapshot/bằng chứng/revision; chỉ đọc |
| POST | /admin/files/{id}/pipeline | action/request_id/revision và trường theo thao tác; [chi tiết phục hồi](../operations/pipeline-recovery.md) |
| POST | /admin/files/{id}/quarantine-review | decision=keep_quarantine/restore, reason 1–500 ký tự |
| POST | /admin/files/{id}/scan-operation | action=check/retry/request_compression/withdraw_compression, request_id UUID |

Quarantine status lọc all/flagged/quarantined/quarantine_delete_failed; q ≤200 ký tự, không phân biệt dấu/hoa thường. Mỗi trang tối đa 10 Query; trang rỗng có thể còn cursor. updated_from bao gồm, updated_before loại trừ, ISO datetime có timezone. Cursor gắn pool/phạm vi/bộ lọc.

Overview đọc tối đa 10 Query × 100 item/lượt. Cộng counts qua đủ trang của cùng lượt; users là tổng tài khoản, không cộng qua trang. Không hiển thị tổng dở khi lỗi/phạm vi đổi.

## Quản trị tài khoản, báo cáo và lịch sử

| Method | Đường dẫn | Payload / kết quả |
| --- | --- | --- |
| GET | /admin/accounts | q, role, state=all/active/inactive, owner_id, limit 1–20 (mặc định 10), cursor |
| GET | /admin/accounts/suggestions | q, limit 1–10 (mặc định 8); ID/tên/email/username |
| PATCH | /admin/accounts/{sub}/quota | limit_bytes integer 0..10 TB, revision integer ≥0, request_id UUID, reason 3–300 ký tự |
| PATCH | /admin/accounts/{sub}/access | role=user, enabled boolean, revision, request_id UUID, reason 3–300 ký tự |
| GET | /admin/accounts/{sub}/history | Tối đa 50 sự kiện mới nhất |
| GET | /admin/reports/owners | Danh mục user cho bộ lọc |
| GET | /admin/reports | from_date/to_date YYYY-MM-DD, owner_id tùy chọn, lifecycle=all/active/trashed |
| GET | /admin/reports/export | Bộ lọc như trên; format=csv/pdf; audit trước trả |
| GET | /admin/history | from_date/to_date, owner_id, category, outcome, q, cursor, limit 1–50 (mặc định 20) |
| GET | /admin/history/{event_id} | Chi tiết đã kiểm lại phạm vi |

role filter được router chấp nhận nhưng scope vẫn chỉ có user; chọn admin không mở quyền xem admin. Revision cũ/yêu cầu đang chờ trả 409. UI gợi ý mặc định 8; API cho tăng tối đa 10. Báo cáo mặc định 30 ngày, history mặc định 7 ngày, tối đa 366 ngày. Bộ lọc báo cáo dùng ngày Việt Nam gồm cả ngày cuối.

CSV/PDF có cùng số liệu theo bộ lọc; NDJSON cho web hoặc byte cho client khác. Báo cáo chỉ tính upload hoàn tất còn metadata và kết quả mới nhất, không phải lịch sử mọi scan. Chi tiết [tài khoản](../guides/admin-accounts.md), [báo cáo](../guides/admin-reports.md), [lịch sử](../operations/admin-history.md).

## Thông báo

| Method | Đường dẫn | Payload / kết quả |
| --- | --- | --- |
| GET | /notifications | limit 1–100, cursor; sự kiện cá nhân |
| POST | /notifications | id/kind/title/message/tone/file_id tùy chọn/created_at/read; sự kiện server chỉ cho đánh dấu đọc |
| GET | /admin/notifications | limit/cursor; inbox chung lọc user, biên nhận đọc riêng từng admin |

read chỉ chuyển true. Đánh dấu đọc admin qua POST /notifications với kiểm quyền mới. Không dùng notification làm audit mọi HTTP request. [Thiết kế sự kiện](../design/notifications.md).

## Chi phí

| Method | Đường dẫn | Payload / kết quả |
| --- | --- | --- |
| GET | /billing/policy | Đăng nhập; snapshot chính sách chỉ đọc |
| GET | /billing/usage | month=YYYY-MM tùy chọn; chính owner |
| POST | /billing/activate | policy_version, request_id UUID |
| PATCH | /billing/preferences | budget_vnd integer 0..1.000.000.000, revision integer ≥0, request_id UUID |
| GET | /billing/export | month; CSV owner, có audit |
| GET | /admin/billing/usage | month; chi phí quản trị theo phạm vi |
| GET | /admin/billing/export | month; CSV quản trị, có audit |
| GET | /admin/billing/status | Trạng thái đối chiếu, admin được kiểm lại |
| POST | /admin/billing/reconcile | Đối chiếu ngay, chung lease worker, có audit |
| GET | /admin/billing/versions | month bắt buộc, before integer ≥1 tùy chọn; tối đa 5 bản/lượt |

Không nhận giá/quota từ client chi phí. Tháng sai/tương lai trả 422; phiên bản kích hoạt/revision cũ trả 409. Metadata chưa sẵn sàng trả 503 cho chi phí, không coi như 0 đồng. [Chính sách](../policies/billing.md), [thiết kế](../design/billing.md).

## Lỗi HTTP

| HTTP | Trường hợp điển hình |
| --- | --- |
| 400 / 422 | ID/cursor/tên hoặc schema/tham số sai |
| 401 | Thiếu/sai/hết hạn token, WWW-Authenticate: Bearer |
| 403 | Không đủ quyền hoặc đích ngoài phạm vi |
| 404 | Không có tệp/nội dung thuộc owner hoặc tài khoản đích không tồn tại |
| 409 | Trạng thái/revision xung đột, restore hết hạn, đồng bộ đang chờ |
| 413 | Quá byte hoặc quota |
| 415 | Preview/UTF-8 không hỗ trợ |
| 429 | Lease upload đang bận hoặc cooldown rescan |
| 502 | Chưa xác nhận lưu/đọc/xóa nội dung |
| 503 | Config/quyền/metadata/dịch vụ chưa sẵn sàng |

Mã lỗi phụ thuộc endpoint; bảng nêu trường hợp điển hình, không thay schema OpenAPI của route.

# Hợp đồng HTTP MâySec

Cập nhật 03/11/2026. Schema chính xác của API đang chạy nằm tại /openapi.json và Swagger /docs. Owner lấy từ danh tính đã xác minh; mọi API dữ liệu bên dưới yêu cầu Bearer token. `/health`, `/auth/config` công khai; hai API demo chỉ công khai khi bật cờ trình diễn. Local có thể dùng chế độ dev. Xem [cấu hình và thử Cognito](cognito-backend.md) và [bộ chọn demo](cognito-demo.md).

## Endpoint

| Method | Đường dẫn | Hành vi |
| --- | --- | --- |
| GET | /health | Cấu hình và capabilities; không kiểm quyền AWS end-to-end |
| GET | /me | ID và vai trò user/admin từ danh tính đã xác thực |
| GET | /auth/config | auth_mode và demo_enabled; không trả secret |
| GET | /auth/demo/accounts | Chỉ khi demo bật; danh sách Cognito, đồng bộ bảng users |
| POST | /auth/demo/login | Chỉ khi demo bật; JSON account_id, cấp phiên demo có chữ ký |
| POST | /upload | Multipart trường file, một tệp/request; 201 khi lưu và bookkeeping xác nhận |
| GET | /storage/usage | limit_bytes, used_bytes, reserved_bytes, available_bytes |
| GET | /files | limit 1–100, cursor; area=active (mặc định), trash hoặc all |
| GET | /files/{id}/status | Trạng thái upload/quét, summary và revision chỉnh sửa; chỉ đọc |
| GET | /files/{id}/scan-report | Báo cáo tổng hợp; không trả giá trị PII/OCR |
| POST | /files/{id}/rescan | JSON request_id UUID; 202, workflow version-pinned |
| GET | /files/{id}/content | mode=preview hoặc download; mặc định download |
| GET | /files/{id}/history | Owner-only, limit/cursor, sự kiện audit đã lọc nội dung |
| GET | /admin/quarantine | Admin-only; limit/cursor, owner_id, status, q; trả items/owners/next_cursor |
| GET | /admin/overview | Admin-only; cursor, tổng hợp các tài khoản user thuộc User Pool; counts/users/next_cursor |
| GET | /admin/files/{id} | Admin-only, owner_id bắt buộc; metadata, owner_name, can_read và report tổng hợp |
| GET | /admin/files/{id}/history | Admin-only, owner_id bắt buộc; limit/cursor, lịch sử có tên người/hệ thống thực hiện |
| GET | /admin/files/{id}/content | Admin-only, owner_id bắt buộc; version cách ly đúng cấu hình, ghi audit trước khi trả byte |
| GET / POST | /admin/files/{id}/pipeline | Admin đúng phạm vi user; xem bằng chứng, thử lại cách ly/gửi SNS và đối soát có audit; thông báo chỉ nhận channel=sns; xem [hướng dẫn](pipeline-recovery.md) |
| PATCH | /files/{id}/preferences | JSON starred boolean |
| PATCH | /files/{id}/name | JSON name; chỉ đổi tên hiển thị |
| POST | /files/{id}/trash | Xóa mềm, giữ 30 ngày |
| POST | /files/{id}/restore | Khôi phục khi còn hạn, chưa bắt đầu xóa |
| DELETE | /files/{id} | Xóa vĩnh viễn tệp trong rác/chờ xóa |
| GET | /upload-history | Snapshot tệp đã xóa, phân trang limit/cursor |
| GET / POST | /notifications | Đọc phân trang/lưu sự kiện cá nhân; sự kiện máy chủ chỉ cho đánh dấu đã đọc |
| GET | /admin/notifications | Hộp thư admin, chỉ sự kiện của chủ tệp role=user; biên nhận đọc riêng từng admin |

Danh sách trả items/next_cursor. Thứ tự backend theo file_id; frontend đọc đủ trang rồi tìm/lọc/sắp xếp trên metadata. Cursor được kiểm partition/owner; không phải token xác thực. Không có GET /; GET /upload trả 405.

Toàn bộ API quản trị chỉ xem và xử lý dữ liệu của tài khoản có vai trò `user` trong Cognito. Danh sách, bộ lọc chủ sở hữu và tổng hợp loại cả admin đang đăng nhập, admin khác và tài khoản chưa phân quyền. Gọi trực tiếp owner_id ngoài phạm vi trả 403 trước khi đọc dữ liệu tệp hoặc thay đổi tài khoản đích; owner không tồn tại trả 404. Áp dụng cho tài khoản/quota, thống kê/xuất dữ liệu, chi tiết/lịch sử/nội dung tệp, duyệt cách ly và thao tác quét. Directory được đọc mới mỗi request quản trị; lỗi directory trả 503, không dùng cache quyền cũ để cho phép truy cập. Drive cá nhân của admin vẫn dùng các API owner-only.

Quản trị cách ly lọc ở server trước khi trả từng trang: `status=all|flagged|quarantined|quarantine_delete_failed`, `owner_id` là sub của user thuộc pool; `q` tìm tên hiển thị không phân biệt hoa thường/dấu tiếng Việt, tối đa 200 ký tự. Mỗi lượt tối đa 10 Query; trang có thể rỗng nhưng còn next_cursor. Cursor gắn với pool, danh sách user và bộ lọc; đổi bộ lọc hoặc phạm vi user phải bắt đầu lại. Không dùng Scan hoặc yêu cầu GSI mới. Số tệp trên giao diện là số đã tải, không phải tổng toàn hệ thống.

Lọc cập nhật bằng `updated_from` (bao gồm) và `updated_before` (không bao gồm), ISO datetime có múi giờ. Giao diện chuyển khoảng ngày theo múi giờ trình duyệt sang UTC; cursor cũng gắn với khoảng thời gian này. Thời điểm không đúng cấu trúc trả 503 khi lọc, không tự đoán ngày.

Tổng quan bảo mật chỉ tính tệp active/uploaded của các tài khoản user thuộc pool. Backend trả số lượng của tối đa 10 Query/lượt (100 item/Query), không trả danh sách hay nội dung tệp. Frontend cộng counts từ các trang của cùng lượt tổng hợp, chỉ hiển thị số cuối khi next_cursor hết; users là tổng tài khoản user trong phạm vi quản trị, không cộng qua từng trang. Nếu lỗi hoặc phạm vi user đổi, không hiển thị tổng chưa hoàn tất. Đây là lượt đọc nhiều trang, không phải snapshot giao dịch. Không phát sinh action IAM hoặc GSI mới.

Báo cáo quét của owner và admin dùng cùng schema: bổ sung `detected_format` (text/pdf/png/jpeg/tiff), `extraction_method` (direct_text/pdf_text/textract_image/textract_pdf), `extracted_pages`, `total_pages`, `extraction_duration_ms`. Thuộc tính chưa được bộ quét ghi trả null; không suy ra từ đuôi tệp hoặc kết quả safe. `extraction_complete=false` kèm scan_reason khi chưa đọc đủ; phần đã đọc có phát hiện vẫn giữ flagged. Thời gian là riêng bước trích xuất, không phải tổng thời gian pipeline. Không trả văn bản OCR, giá trị phát hiện hoặc vị trí bí mật.

## Upload và dung lượng

- Mỗi tệp tối đa 100.000.000 byte = 100 MB; cấu hình thấp hơn có thể giảm trần. Middleware cho thêm 1 MiB overhead multipart.
- Quota mặc định 1.000.000.000 byte/owner, có thể chỉnh riêng qua API quản trị. Không cho giảm thấp hơn used_bytes + reserved_bytes. used_bytes tính uploaded kể cả trashed/deleting; uploading/unknown giữ chỗ trong reserved_bytes; failed không tính.
- Không cộng partition quota/history/notifications vào dung lượng nội dung. Bản cách ly tính một lần; quota logic không phải tổng byte vật lý của mọi version S3.
- S3 bắt buộc metadata DynamoDB để kiểm quota; Local có kiểm quota đĩa kể cả metadata disabled.
- Key: uploads/{owner_id}/{file_id}/{safe_filename}. Trả id, key, storage, original_name, size_bytes, content_type và scan_status; metadata bật có thêm trạng thái/revision.
- owner_id là sub của Cognito, không phải username, nhóm hay AWS CLI profile. Danh sách/quota/nội dung/thao tác chỉ trong phạm vi owner; admin cũng không được đọc tệp người khác qua API người dùng. Các prefix S3 xuất hiện sau khi tài khoản upload; dữ liệu dev-user cũ không tự chuyển.
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

Notifications lưu id, kind, title, message, tone, file_id tùy chọn, created_at và read. read chỉ chuyển sang true. Scan/Quarantine ghi kết quả từ máy chủ; quota/thư mục/xem xét cách ly ghi cùng transaction. Browser chỉ sửa trạng thái đã đọc của sự kiện máy chủ. Xem [hợp đồng thông báo](notifications.md); đây không phải push hệ điều hành hoặc audit log đầy đủ.

## Thư mục theo chủ sở hữu

Capability `folders` yêu cầu metadata và audit sẵn sàng. Tất cả API thư mục lấy owner từ danh tính đã xác minh; admin dùng cùng API chỉ thao tác Drive của chính mình.

| API | Payload / kết quả |
| --- | --- |
| GET /folders | Danh sách toàn bộ thư mục của owner, gồm thư mục ở rác; `items`, `next_cursor=null`. Backend đọc đủ các trang DynamoDB. |
| POST /folders | `{name, parent_id: UUID hoặc null}`; tạo tại gốc nếu bỏ parent_id. |
| PATCH /folders/{id} | `{name}`; đổi tên thư mục đang hoạt động. |
| POST /folders/{id}/move | `{parent_id: UUID hoặc null}`; cấm chu trình và tên trùng tại đích. |
| POST /folders/move-files | `{file_ids: UUID[1..50], folder_id: UUID hoặc null}`; cập nhật metadata cả nhóm trong giao dịch. |
| POST /folders/{id}/trash | Đưa cây và tệp active vào rác, giữ key S3/quota/kết quả quét; ghi `trash_root_id`. |
| POST /folders/{id}/restore | Khôi phục nhóm đã xóa bởi thư mục này; không hồi sinh tệp đã xóa riêng hoặc purged. |
| DELETE /folders/{id} | Chỉ từ rác; xóa nội dung qua FileLifecycle trước khi bỏ metadata thư mục. Có thể thử lại khi xóa dở. |

Folder có `id`, `name`, `parent_id`, `lifecycle_state`, `trashed_at`, `trash_expires_at`, `trash_root_id`, `purging`. Tên được chuẩn hóa Unicode, tối đa 120 ký tự, dùng quy tắc tên tương tự file. Thư mục cũ không có parent/lifecycle được hiểu là thư mục gốc active.

Upload nhận thêm trường multipart `folder_id` tùy chọn; xác minh thư mục còn hoạt động và lưu vị trí cùng metadata trước khi ghi nội dung. File list/status trả thêm `folder_id`, `folder_updated_at`, `trash_root_id`. Chi tiết admin có đường dẫn thư mục của owner trong `folder_path`.

Cây thư mục dùng partition `!folders!<owner>` trong bảng files. Item `!revision` là token đồng thời nội bộ, không trả như thư mục. Create/rename/move/trash/restore, chuyển tệp và upload vào thư mục dùng cùng revision; tránh chu trình, file vào đích vừa xóa và xóa thiếu file đang chuyển. Giao dịch có điều kiện lifecycle/scan/upload để không ghi đè pipeline. Xóa/khôi phục tối đa 97 thư mục+tệp mỗi giao dịch; vượt giới hạn trả 409 trước khi ghi. Trash chặn khi còn uploading/unknown/scanning/flagged; hạn khôi phục 30 ngày. Purge đặt cờ purging trước khi xóa byte, chặn restore và giữ khả năng retry nếu lỗi.

## Lỗi API

| HTTP | Trường hợp điển hình |
| --- | --- |
| 400 / 422 | ID/cursor/tên không hợp lệ hoặc payload sai schema |
| 401 | Thiếu, sai hoặc hết hạn access token; kèm WWW-Authenticate: Bearer |
| 403 | Tài khoản không thuộc nhóm user/admin được phép |
| 404 | Không có tệp/nội dung của owner hiện tại |
| 409 | Trạng thái không cho phép, hết hạn restore hoặc tranh chấp |
| 413 | Vượt giới hạn byte hoặc quota |
| 415 | Không hỗ trợ preview/UTF-8 |
| 429 | Quota đang khóa hoặc cooldown quét lại |
| 502 | Chưa xác nhận lưu/đọc/xóa nội dung |
| 503 | Thiếu cấu hình/quyền, metadata sai hoặc dịch vụ chưa sẵn sàng |

Lỗi ứng dụng trả JSON detail. capabilities chỉ báo readiness cấu hình/client. Backend dùng credentials chain của Boto3; frontend không giữ quyền AWS. CORS không thay cho xác thực.

Test/script hỗ trợ chỉ lưu local, không đưa vào Git. Khi có bộ test, chạy pytest trong backend và npm test/test:ui trong frontend; npm run build không cần bộ test. Cài/chạy theo [api-guide.md](api-guide.md); cập nhật AWS theo [handoff](AWS-HANDOFF-QUICKSTART-2026-10-31.md).

## Báo cáo, tài khoản và quota của admin

Các endpoint `/admin/reports`, `/admin/reports/owners`, `/admin/reports/export`, `/admin/accounts`, `/admin/accounts/{sub}/quota`, `/admin/accounts/{sub}/access`, `/admin/accounts/{sub}/history` được mô tả cùng bộ lọc, request/revision và quy tắc phân quyền tại [hướng dẫn quản trị](admin-reports-accounts.md).

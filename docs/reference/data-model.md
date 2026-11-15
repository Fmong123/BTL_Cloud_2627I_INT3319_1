# Mô hình dữ liệu

Nguồn: [db.py](../../backend/app/db.py), [FileMetadataRepository](../../backend/app/services/file_metadata.py), [schema API](../../backend/app/schemas/file.py), [Folders](../../backend/app/services/folders.py), [lifecycle](../../backend/app/services/lifecycle.py), [UserProfiles](../../backend/app/services/user_profiles.py), [pipeline_common](../../AWS/Lambda_AWS/pipeline_common.py) và các service billing.

Đây là mô hình hiện hành trong code. Bản đề xuất cũ tại [archive](../archive/legacy/dynamodb-item-schema.md).

## Kiểu và quy ước

| Kiểu DynamoDB | Giá trị ứng dụng |
| --- | --- |
| String (S) | ID, enum, tên, key, timestamp ISO có timezone |
| Number (N) | Byte/count/revision nguyên; duration_ms không âm; thời điểm lease theo epoch khi service quy định |
| Boolean (BOOL) | active, starred, read, cờ completeness/pending |
| List (L) | finding_types, danh sách breakdown hoặc các khoảng tài chính theo service |
| Map (M) | review, scan_result, chi tiết audit và yêu cầu đang chờ |
| Binary (B) | Snapshot tài chính nén theo bộ mã hóa service |
| Null/thiếu thuộc tính | Chưa có giá trị; không suy thành kết quả thành công |

Timestamp nghiệp vụ chuẩn hóa UTC (ví dụ 2026-11-14T03:00:00.000Z), không dùng chuỗi ngày thiếu timezone. Nội dung nằm ở Local/S3, DB giữ metadata/tóm tắt. Không lưu mật khẩu/token/credentials vào hồ sơ. API whitelist trường, không trả nguyên item.

## Khóa vật lý

| Bảng mặc định | Partition key (String) | Sort key (String) |
| --- | --- | --- |
| securedrive-files | owner_id | file_id |
| securedrive-audit-log | file_id | event_key |
| securedrive-users | user_id | Không có |

DynamoDB region ap-southeast-2; tên bảng cấu hình bắt đầu securedrive-. Thuộc tính ngoài khóa được ghi động; không thêm cột SQL. Không cần tạo bảng/GSI mới để dùng các nghiệp vụ hiện có. created_order/status_time không tự tạo index.

## Các partition trong bảng files

| owner_id | file_id | Nội dung |
| --- | --- | --- |
| sub của owner (dev-user khi dev) | UUID tệp | Metadata tệp sống |
| !folders!<owner> | UUID thư mục | Cây thư mục |
| !folders!<owner> | !revision | Revision cây dùng chung |
| !quota!<owner> | lock | Lease nhận upload/đổi quota |
| !quota!<owner> | settings | limit_bytes, revision, dữ liệu request quản trị |
| !history!<owner> | UUID tệp | Snapshot sau purge |
| !notifications!<owner> | created_at#id | Thông báo/biên nhận cá nhân |
| !notifications!<UUID zero> | created_at#id | Inbox yêu cầu xem xét dành cho admin |
| !quota!<owner> | billing | Theo dõi/kích hoạt/chính sách/ngưỡng chi phí |
| !quota!<owner> | billing-file-<id> | Ledger khoảng tồn tại tệp và thống kê cần bổ sung |
| !quota!<owner> | billing-scan-* | Thống kê xử lý có ID chống trùng |
| !quota!<owner> | billing-alerts | Marker chống trùng cảnh báo |
| !quota!<UUID zero> | billing-roster | Khoảng user được quản lý |
| !quota!<UUID zero> | billing-period-YYYY-MM, billing-period-YYYY-MM-rN | Bản đối chiếu tháng và revision cũ |
| !quota!<UUID zero> | billing-reconciliation, billing-monitor-lock | Trạng thái đối chiếu và lease worker |

UUID zero = 00000000-0000-0000-0000-000000000000 là định danh hệ thống, không phải tài khoản đăng nhập. Các lease/phụ trợ khác dùng cùng partition theo service; bảng trên liệt kê nhóm nghiệp vụ chính. Không đưa item nội bộ vào thư viện/quota byte nội dung.

## Metadata tệp

### Thuộc tính ban đầu

| Trường | Kiểu | Ý nghĩa |
| --- | --- | --- |
| owner_id, file_id | S | Khóa ghép; sub từ danh tính, UUID tệp do backend tạo |
| original_name, key | S | Tên gốc và uploads/{owner}/{file}/{safe_filename} |
| size_bytes | N | Số nguyên dương |
| content_type | S | MIME khai báo được dùng kiểm điều kiện nội dung; không phải scanner xác minh định dạng |
| storage | S | local hoặc s3 |
| upload_bucket | S | Bắt buộc cho S3; không ghi cho Local |
| upload_state | S | uploading lúc tạo; uploaded/failed/unknown theo kết quả storage |
| status | S | scanning khi S3 pipeline bật, còn lại not_started |
| findings_count, finding_types | N, L<S> | Khởi tạo 0/[]; chưa phải kết quả scan |
| created_at, updated_at | S | Mốc metadata UTC |
| created_order, status_time | S | Mốc thời gian#file_id cho sắp xếp/tham chiếu |
| folder_id, folder_updated_at | S tùy chọn | Thư mục đích được xác minh khi nhận upload |

### Thuộc tính phát sinh

| Nhóm | Trường / kiểu chính |
| --- | --- |
| Trình bày | display_name S, name_updated_at S, starred BOOL, starred_updated_at S |
| Vòng đời | lifecycle_state S, lifecycle_updated_at S, trashed_at S, trash_expires_at S, trash_root_id S/null |
| Guard pipeline | execution_id S, source_version_id S, pipeline_busy BOOL và request/token nội bộ |
| Báo cáo quét | findings_count N, finding_types L<S>, scan_result M chứa findings và finding_counts M loại→N; extraction_complete BOOL, scanned_at S, status_reason/scan_reason S |
| Trích xuất | detected_format S, extraction_method S, extracted_pages/total_pages/extraction_duration_ms N |
| Quét lại | scan_request_id S, rescan_requested_at S, rescan_dispatch S, rescan_actor S và bằng chứng execution |
| Cách ly | quarantine_status S, quarantine_bucket/key/version_id S, quarantined_at S, kms_key S nếu writer ghi |
| Xem xét | quarantine_review M: id/status/reason/requested_at/version; decision_reason/decided_at/decided_by khi duyệt |
| Nén | compression_requested_at/resolved_at S, compression_resolution S |
| SNS | Trường notify_* chứa trạng thái/token/receipt theo result; không trả token ra API |
| Chi phí | billing_uploaded_at S, billing_usage_pending BOOL, billing_processing_record M |

Không cần điền mọi thuộc tính lúc upload. Chi tiết tên trường theo writer/service; summary top-level được ưu tiên, adapter có đọc scan_result cũ tương thích nhưng không trả findings/location. Copy cách ly lỗi giữ status=flagged; không dùng mapping error của đề xuất cũ.

API chuyển scan_result.finding_counts thành list type/count và tính counts_complete bằng cách so tổng breakdown với findings_count. Không có yêu cầu writer ghi counts_complete hoặc finding_counts ở top-level.

Quarantine key được kiểm khớp key nguồn + .version-<source_version_id>; location luôn cần đúng bucket cấu hình và quarantine_version_id. Không suy location từ tên hiển thị.

### Mapping ra API

| DB | API | Frontend |
| --- | --- | --- |
| file_id | id | remoteId |
| status | scan_status | scanStatus |
| original_name + display_name tùy chọn | original_name, display_name | Tên hiển thị |
| size_bytes | size_bytes | size |
| content_type | content_type | type |
| created_at | created_at | createdAt |
| scan_request_id | rescan_request_id trong scan-report | Token retry rescan |

Ngoại lệ: status=quarantined và quarantine_review.status=restored đúng version → API scan_status=restored; DB không đổi scanner status thành safe/restored. Thiếu lifecycle_state cũ hiểu active, thiếu starred hiểu false. Không tự chữa metadata sai/thiếu trường bắt buộc; API trả lỗi dịch vụ.

Danh sách/status/report có schema khác nhau; không suy rằng mọi trường item đều được công khai. Xem [API](api.md).

## Thư mục và snapshot

Folder lưu owner_id=!folders!<owner>, file_id=UUID, name S, parent_id S/null, created_at S; phát sinh lifecycle_state, lifecycle_updated_at, trashed_at, trash_expires_at, trash_root_id và purging BOOL. !revision giữ revision S do service sinh để bảo vệ thay đổi cây.

Snapshot !history!<owner> giữ whitelist metadata và lifecycle_state=purged; bổ sung mốc billing_deleted_at, giữ billing_uploaded_at và thống kê đang chờ khi cần. API dựng owner logic từ partition snapshot, không dùng !history! làm danh tính người dùng. Không TTL/xóa lịch sử tài chính/audit còn cần đối chiếu.

## Audit

event_key = occurred_at#event_id, cùng sự kiện giữ ID/thời điểm/payload để replay không trùng. Cùng key khác payload gây conflict. Trường chính: file_id S, owner_id S, action S, actor S, occurred_at S, details M; có thể thêm execution_id/from_status/to_status.

Audit không chỉ có tệp: quản trị tài khoản, thư mục, chi phí dùng ID đối tượng do service quy định. API lịch sử cá nhân/admin whitelist riêng, không xuất nguyên details, OCR/PII, token hoặc key/version nội bộ. Repository không thay kiểm quyền của router.

## Hồ sơ users

user_id=sub; username/name/email S (email tùy dữ liệu directory), role S, active BOOL, cognito_status S, created_at/updated_at/last_login_at S. Upsert giữ created_at. Nhóm Cognito là nguồn vai trò; item users phục vụ hồ sơ và kiểm trạng thái khóa/chờ đồng bộ.

Quản trị thêm management_revision N và management_pending M để tiếp tục thay đổi Cognito–DB chưa rõ kết quả. Không lưu mật khẩu hoặc AWS credentials. Xem [quản trị tài khoản](../guides/admin-accounts.md).

## Thông báo và tài chính

Thông báo có id/kind/title/message/tone/created_at S, read BOOL, file_id tùy chọn; sự kiện server có server_event=true và đích điều hướng do server quyết định. Admin có biên nhận riêng trong partition cá nhân. [Thiết kế thông báo](../design/notifications.md) mô tả chống trùng.

Ledger/roster/snapshot tài chính do bộ mã hóa [billing_ledger.py](../../backend/app/services/billing_ledger.py) và [billing.py](../../backend/app/services/billing.py) quản lý. Snapshot kỳ nén không phải tài liệu JSON để sửa tay; retry giữ mốc, thay dữ liệu có revision mới. [Thiết kế chi phí](../design/billing.md) mô tả tích phân và phục hồi.

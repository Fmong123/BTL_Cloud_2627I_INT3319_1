> Hướng dẫn cài đặt: [Bàn giao ngắn gọn](AWS-HANDOFF-QUICKSTART-2026-10-31.md).

# PHỤ LỤC KỸ THUẬT

Thông tin để cấu hình và xử lý lỗi khi triển khai. Làm theo tab “Bàn giao ngắn gọn”; JSON policy và source đầy đủ nằm trong gói ZIP, không cần chép lại vào tài liệu.

## 1. Quyền cần cấp

Backend dùng principal riêng; mỗi Lambda dùng execution role của nó. Bổ sung quyền còn thiếu, đối chiếu đúng account 018913575473, region, bucket và ARN. Không thay toàn bộ role đang hoạt động.

| Thành phần | Quyền chính |
| --- | --- |
| Backend · DynamoDB | files: GetItem, Query, PutItem, UpdateItem, DeleteItem, ConditionCheckItem. audit-log: GetItem, PutItem. |
| Backend · S3 | Upload: PutObject, GetObject, GetObjectVersion, AbortMultipartUpload. Cả hai bucket: ListBucketVersions, DeleteObject, DeleteObjectVersion. |
| Backend · quét lại | states:DescribeStateMachine và states:StartExecution trên đúng workflow STANDARD. |
| Lambda cleanup | files: Scan, GetItem, UpdateItem, PutItem, DeleteItem. Cả hai bucket: ListBucketVersions, DeleteObject, DeleteObjectVersion; thêm CloudWatch Logs. |

Phạm vi backend: chỉ dữ liệu owner hiện tại dev-user và các partition !quota!dev-user, !history!dev-user, !notifications!dev-user. S3 giới hạn prefix uploads/dev-user/. Role cleanup có phạm vi uploads/ để dọn rác hết hạn. Policy mẫu đã có điều kiện prefix/partition; giữ đúng khi áp dụng.

Ba Lambda pipeline giữ quyền hiện có: Scan đọc version nguồn, Textract, files/audit; Quarantine copy/kiểm tra đích, xóa version nguồn, KMS và files/audit; Notify publish SNS và files/audit. Giữ CloudWatch Logs. Step Functions cần InvokeFunction; EventBridge cần StartExecution và quyền invoke cleanup tương ứng.

Dùng ba file policy backend-runtime, backend-quota-rescan và trash-cleanup được chỉ rõ trong hướng dẫn cài; thay placeholder bằng tài nguyên thật. IAM cho transaction dùng các quyền thành phần trong bảng, không thêm action dynamodb:TransactWriteItems. Nếu S3 dùng SSE-KMS, kiểm thêm KMS key policy/quyền cần cho đọc và copy.

## 2. Dữ liệu và nguyên tắc xử lý

- Giữ bảng securedrive-files (owner_id/file_id), securedrive-audit-log (file_id/event_key), securedrive-users (user_id); DynamoDB ở ap-southeast-2. Key S3 giữ uploads/{owner_id}/{file_id}/{filename}; đổi tên chỉ sửa display_name.

- Quota cộng tệp đã upload, kể cả trashed/deleting; giữ chỗ cho uploading/unknown. Không cộng các partition quota/history/notifications hoặc tính trùng bản cách ly. Không cần tạo bảng quota mới hay reset dữ liệu.

- Vòng đời: active → trashed → deleting → xóa xong. Khôi phục trong 30 ngày giữ kết quả quét/cách ly. Chỉ xóa metadata và giảm quota sau khi xác nhận hết Versions/DeleteMarkers ở nguồn và cách ly; lỗi một phần giữ deleting để thử lại.

- Quét lại đọc đúng source_version_id, dùng scan_request_id và execution_id mới. Cả ba Lambda phải có pipeline_common.py mới để chặn execution cũ/tệp trong rác. Chỉ bật ARN rescan sau khi cập nhật đồng bộ; ARN STANDARD không gắn alias/version.

- Báo cáo giữ tổng phát hiện, loại/số lượng, scanned_at, scan_reason và extraction_complete. Không trả nội dung OCR hoặc giá trị nhạy cảm. Lịch sử sau xóa chỉ giữ metadata; lịch sử/thông báo không chứa nội dung tệp.

## 3. Khi có lỗi

- Xóa vĩnh viễn thất bại: kiểm principal backend, ListBucketVersions và DeleteObject/DeleteObjectVersion ở cả hai bucket; xem lỗi server. Không xóa bản ghi DynamoDB hoặc ép quota giảm để bỏ qua lỗi.

- Quét lại chưa bật: kiểm ARN STANDARD, DescribeStateMachine/StartExecution, version nguồn và restart worker. /health chỉ xác nhận cấu hình; thử một tệp mẫu để xác nhận luồng thật.

- AccessDenied dù đã gắn policy: đối chiếu resource/prefix/LeadingKeys, permissions boundary, bucket policy, SCP và KMS. User ứng dụng không cần quyền quản trị IAM/Lambda để chạy chức năng.

Audit 31/10: securedrive-key → securedrive-db-dev; đã xác nhận thiếu ListBucketVersions ở hai bucket. GetItem/Query DynamoDB thành công; quyền ghi/xóa và cấu hình Lambda/workflow chưa xác minh. Chưa xác nhận profile của FastAPI đang chạy. Chưa deploy AWS; giữ lịch cleanup tắt đến khi nghiệm thu đạt.

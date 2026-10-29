# Đồng bộ source AWS với backend

## Phạm vi

Source giữ nguyên ba tên Lambda, tên bảng và khóa files `owner_id/file_id`, audit `file_id/event_key`, đường dẫn `uploads/{owner_id}/{file_id}/{filename}` và mapping API `file_id -> id`, `status -> scan_status`. Không yêu cầu Cognito để test với `dev-user`; owner được đọc động từ key, không hardcode trong Lambda.

Đã kiểm tra trong máy: 24 ca AWS mới, 58 ca repository/cấu hình/checker backend và 67 ca HTTP backend. Các ca đều dùng client giả hoặc SDK Stubber, không gọi dịch vụ AWS thật. Môi trường giới hạn chặn socket nội bộ của TestClient; 67 ca HTTP đã chạy thành công bên ngoài giới hạn đó. Chưa validate definition bằng API AWS hoặc nghiệm thu bản triển khai thật.

Các file trong thư mục này chưa được tự động áp dụng lên AWS. Không dùng bản repo để suy ra cấu hình thực tế đã thay đổi. Lấy code và cấu hình đang triển khai để đối chiếu trước khi cập nhật.

## Hợp đồng dữ liệu mới

- Backend tạo metadata trước upload; Lambda chỉ cập nhật item đã tồn tại, đúng bucket/key/version, storage S3 và trạng thái cho phép. Không tự tạo item thiếu metadata.
- Scan đọc chính xác version từ sự kiện, ghi `source_version_id`, `execution_id`, `scanned_at`, `status_time`, `findings_count`, `finding_types`, `scan_result`, `extraction_complete` và lý do khi cần. Workflow nhận summary và findings chỉ có type; không truyền location hoặc văn bản OCR.
- `findings_count` là tổng phát hiện, độc lập giới hạn `MAX_FINDINGS`. Quarantine không tính lại hoặc ghi đè summary của Scan.
- Copy/kiểm tra copy thất bại giữ `status=flagged`, ghi `quarantine_status=copy_failed` và lý do. Xóa nguồn lỗi dùng `quarantine_delete_failed`/`delete_failed`. Hoàn tất dùng `quarantined`/`completed`.
- Cách ly lưu `quarantine_bucket`, `quarantine_key`, `quarantine_version_id` khi có, `source_version_id`, `kms_key`, `quarantined_at`; ghi bằng chứng bản copy trước khi xóa đúng version nguồn. Retry giữ vị trí bản đã copy và không copy lại khi bản đó đã xác minh.
- Thành công sau lỗi cách ly xóa lý do lỗi cách ly cũ. Nếu Scan chỉ đọc được một phần nhưng đã phát hiện PII, vẫn giữ `flagged` rồi cách ly và giữ lý do trích xuất chưa đầy đủ.
- Audit có owner/file, UTC milliseconds, action và execution ID. Action chuẩn: `scan_safe`, `scan_flagged`, `scan_unscanned`, `scan_error`, `quarantine_completed`, `quarantine_failed`, `quarantine_delete_failed`, `notify_safe`, `notify_quarantined`, `notify_failed`. Có thêm audit thành công theo kênh `notify_{result}_sns/webhook`.
- Quarantine và Notify không thay đổi `upload_state`. Gửi thông báo lỗi không đổi kết quả safe/quarantined.

Các quy ước copy thất bại giữ flagged trong tài liệu này theo báo cáo tiến độ 2; một số tài liệu cũ ở `docs/` vẫn mô tả copy thất bại thành error và cần được cập nhật khi nhóm chốt toàn bộ tài liệu.

## Cấu hình trên AWS cần đối chiếu

| Thành phần | Cập nhật |
|---|---|
| S3 Upload | Versioning Enabled; thử bằng file mới có version ID. Không đổi bucket hoặc xóa dữ liệu để test. |
| EventBridge | Giữ rule đúng bucket Upload và prefix uploads/, truyền nguyên sự kiện có detail.bucket.name, detail.object.key và detail.object.version-id. Workflow trong repo nhận định dạng EventBridge. |
| Scan | Đúng FILES_TABLE/AUDIT_TABLE; STRICT_DB_WRITE=true; quyền GetItem/UpdateItem files, GetItem/PutItem audit, GetObjectVersion nguồn và Textract. |
| Quarantine | Đúng FILES_TABLE/AUDIT_TABLE, QUARANTINE_BUCKET, KMS_KEY_ID là key ARN hoặc key UUID thực tế; source không nhận KMS alias chưa phân giải. Quyền đọc DB, copy/đọc đích, xóa đúng version và KMS. |
| Notify | Đúng FILES_TABLE/AUDIT_TABLE, SNS_TOPIC_ARN và WEBHOOK_URL nếu dùng; quyền GetItem/UpdateItem files để giữ trạng thái giao nhận và GetItem/PutItem audit. |
| Step Functions | Cập nhật State_machine.json và role có lambda:InvokeFunction cho ba Lambda. Nhánh lỗi gọi lại writer với operation=record_failure, không thực hiện lại việc gửi thông báo hoặc xóa S3. |

ARN trong policy là tài nguyên hiện có của nhóm; xác minh tài khoản/region/bucket/key trước khi áp dụng. Backend dùng `DYNAMODB_FILES_TABLE`/`DYNAMODB_AUDIT_TABLE`, Lambda dùng `FILES_TABLE`/`AUDIT_TABLE`; tên biến khác nhau nhưng giá trị phải trỏ cùng bảng. Client DynamoDB của Lambda dùng region của Lambda; triển khai tại Sydney `ap-southeast-2` như backend.

Timeout Lambda Scan cần đủ cho OCR (ví dụ 150 giây để kiểm thử mục tiêu 120 giây); kiểm tra bộ nhớ, dependency và khả năng Textract thực tế. Scan giữ giới hạn 50 MiB, backend upload mặc định 100 MiB: file ngoài giới hạn Scan được ghi unscanned, không tự giảm giới hạn upload. PDF có ảnh/vùng scan chuyển qua OCR để tránh coi riêng lớp chữ là toàn bộ tài liệu. OCR rỗng, thiếu trang hoặc partial không nhận safe. Khả năng OCR và chất lượng phát hiện vẫn cần nghiệm thu với mẫu thật; source hiện có bộ phát hiện CCCD và số thẻ, chưa bổ sung detector mật khẩu/bí mật nghiệp vụ theo phạm vi mở rộng.

## Đóng gói và kiểm thử trong máy

Từ thư mục project chính, dùng Python có boto3 và pytest (venv backend hiện có):

```powershell
.\backend\.venv\Scripts\python.exe AWS\scripts\build_packages.py
.\backend\.venv\Scripts\python.exe -m pytest AWS\tests -q --basetemp=AWS/build/pytest-local
```

Script tạo ba ZIP trong `AWS/build/`, mỗi ZIP có `handler.py` và `pipeline_common.py`. Boto3 được Lambda Python runtime cung cấp; nếu dùng pypdf để trích xuất trực tiếp thì thêm dependency tương thích runtime vào gói hoặc layer. ZIP source hiện tại không tự cài pypdf. Thư mục build bị bỏ qua trong Git.

Chỉ kiểm thử bằng client giả trong máy; không có lệnh tự triển khai hoặc tự gọi AWS trong script đóng gói/tests. Các kiểm tra local không thay thế việc validate definition trên AWS và chạy integration test sau triển khai.

## Thứ tự cập nhật môi trường đang chạy

1. Lưu và đối chiếu code, handler, biến môi trường, layer, role, workflow và các version/alias đang dùng. Đợi các execution hiện tại hoàn tất trước khi thay đổi bộ mã phối hợp; các hàm không gắn version có thể được gọi bằng mã mới ngay trong execution cũ.
2. Bổ sung IAM cần thiết từ các policy trong `IAM/`; giữ quyền ghi log, trust policy, EventBridge StartExecution và key policy KMS phù hợp. Các file policy riêng không thay thế toàn bộ cấu hình role.
3. Đưa ba gói ZIP lên đúng Lambda, handler `handler.lambda_handler`; cấu hình biến môi trường và dependency như bảng trên. Nếu dùng alias, publish version và trỏ alias đúng bản cần kiểm thử.
4. Validate rồi cập nhật workflow. Nếu workflow hoặc Lambda đang được gọi bằng alias/version ARN, cập nhật tham chiếu tương ứng; file trong repo hiện gọi tên Lambda không gắn version.
5. Upload file mới qua backend cấu hình s3 + dynamodb + pipeline=true. Kiểm file sạch, PII giả, unsupported, copy lỗi, xóa lỗi, DB/audit lỗi và thông báo lỗi theo kế hoạch test của nhóm. Không tạo lỗi bằng cách sửa policy hoặc xóa object dùng chung đang phục vụ người khác.
6. Đối chiếu cùng owner/file/version giữa API, DynamoDB, execution, S3 và audit. Kiểm email thật riêng; SNS MessageId chưa chứng minh thư đã đến hộp thư.

Không cần tạo lại bảng để thêm thuộc tính. Item cũ không tự được bổ sung trường mới hoặc trạng thái giao nhận. Ưu tiên nghiệm thu bằng file upload mới; đối soát dữ liệu cũ trước khi replay để tránh gửi lại thông báo đã gửi bằng code cũ.

## Giới hạn thử lại và thông báo

Notify giữ trạng thái riêng `notify_{safe|quarantined}_{sns|webhook}_state` trên item files, cùng `_token`, `_at`, `_sent_at`, `_receipt`. Trạng thái có thể là sending/sent/failed/unknown. Conditional claim chặn hai lượt cùng gửi, kênh sent được bỏ qua khi retry, lỗi từ chối rõ ràng có thể thử lại. Không lưu webhook URL hay nội dung PII vào audit.

Nếu timeout hoặc không chắc dịch vụ ngoài đã nhận, giữ unknown; nếu process chết/DB lỗi sau gửi, có thể còn sending. Source không tự gửi lại hai trạng thái này để tránh trùng. Admin cần đối chiếu CloudWatch, SNS message/log hoặc hệ thống nhận, rồi quyết định đánh dấu sent (kèm receipt) hay failed để cho phép retry. Việc đối soát này chưa có API quản trị tự động. SNS/webhook không được bảo đảm exactly-once ở mọi trường hợp.

Execution ID bảo vệ việc ghi kết quả của lượt đang xử lý. Với file còn scanning/flagged sau một execution thất bại, ưu tiên redrive/retry cùng execution; chuyển quyền xử lý sang execution khác cần đối soát và mở khóa execution_id có kiểm soát. Source không tự tiếp quản một lượt chưa xác định kết quả. File đã safe/quarantined có thể replay kết quả và sửa audit thiếu, không quét lại hoặc hạ trạng thái.

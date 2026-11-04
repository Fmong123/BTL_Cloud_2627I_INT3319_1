# Hạn mức dung lượng, báo cáo quét và quét lại

## Chạy và cấu hình

Khởi động lại backend và frontend sau khi cập nhật source. API mới:

- `GET /storage/usage`: `limit_bytes`, `used_bytes`, `reserved_bytes`, `available_bytes`.
- `GET /files/{id}/scan-report`: trạng thái và summary hiện tại, số lượng theo loại, `counts_complete`, `extraction_complete`, lý do, thời điểm quét/yêu cầu quét lại. Không trả OCR, giá trị PII hoặc location nội bộ.
- `POST /files/{id}/rescan`, JSON `{"request_id":"<UUID>"}`: nhận yêu cầu với HTTP 202, trả báo cáo hiện tại. Gửi lại cùng UUID để xác nhận một lượt khởi chạy chưa rõ kết quả; không sinh UUID mới khi retry do timeout.

Frontend bật theo `health.capabilities.storage_quota`, `scan_report`, `rescan`. API cũ không có capability vẫn dùng summary và dung lượng tạm tính; không bật thao tác quét lại. Trên panel thông tin có nút **Báo cáo quét**; tab Xử lý chứa báo cáo và nút **Quét lại tệp** riêng với Cập nhật trạng thái.

## Hạn mức 1 GB

Hạn mức cố định 1.000.000.000 byte cho mỗi owner; giới hạn mỗi tệp vẫn 100.000.000 byte. Tệp cách ly vẫn chiếm dung lượng logic một lần. Các phiên bản/bản copy vật lý S3 không được cộng thêm vào gói người dùng.

Với DynamoDB, tính toàn bộ các trang bằng consistent read. `uploaded` tính vào đã dùng; `uploading`, `unknown` và bản ghi cũ chưa rõ trạng thái giữ chỗ toàn bộ dung lượng; `failed` không tính. Kết quả lưu trữ chưa xác định không được tự giải phóng chỗ. Dữ liệu cũ được tính ngay, không cần backfill counter hoặc tạo bảng mới. Metadata thiếu dung lượng hợp lệ làm kiểm tra quota trả 503, không bỏ qua bản ghi để cho upload.

Việc nhận upload được bảo vệ bằng lease trong partition `owner_id=!quota!<owner>, file_id=lock` ở cùng bảng files. Chỉ giữ lease trong lúc cộng dung lượng và tạo bản ghi upload. Transaction kiểm tra token/lease và tạo bản ghi cùng lúc; upload mạng chạy sau khi nhả lease. Lease hết hạn sau 60 giây; request khác đợi tối đa 4 giây rồi trả 429 nếu vẫn bận. Lock hết hạn không cho phép writer cũ tạo bản ghi khi lock đã bị tiếp quản. Upload vượt tổng dung lượng trả 413 trước khi gọi S3.

Tất cả API worker nhận upload phải chạy source mới. Writer ngoài API hoặc bản backend cũ không tham gia lease có thể vượt qua hạn mức, nên phải ngừng các writer cũ khi triển khai. Query mỗi lần upload có chi phí theo số metadata; có thể chuyển sang counter giao dịch khi kho lớn hơn.

Local storage dùng khóa SQLite trên thư mục dữ liệu để phối hợp các worker, cộng kích thước tệp thực tế và giữ khóa xuyên suốt lần ghi. Dữ liệu vẫn được tính sau khi restart. Tệp tạm/bản ghi vật lý còn sót được tính bảo thủ. Local + DynamoDB phải thỏa cả quota logic và dung lượng vật lý. S3 không bật metadata bị từ chối upload với 503 vì chưa thể xác minh quota.

`available_bytes = max(0, limit_bytes - used_bytes - reserved_bytes)`. Sidebar dùng số backend khi capability có sẵn, hiển thị riêng dung lượng giữ chỗ và trạng thái lỗi cập nhật. Tài khoản hiện vẫn là owner phát triển `dev-user`; chưa bổ sung đăng nhập trong thay đổi này.

## Quét lại trên AWS

1. Cập nhật code cả ba Lambda từ repo, bao gồm `pipeline_common.py`; cập nhật trước khi bật API rescan. Guard từ chối execution cũ sau khi tệp có lượt quét lại mới. Giữ workflow ở `AWS/Orchestration/State_machine.json`, dạng **STANDARD**.
2. Backend cần quyền DynamoDB hiện có và thêm `dynamodb:ConditionCheckItem` để transaction nhận upload, quyền xóa item lease trong partition `!quota!…`; không cấp quyền xóa tùy ý bản ghi tệp chỉ vì quota. IAM bổ sung tham khảo `AWS/IAM/securedrive-backend-quota-rescan-policy.example.json` và thay account/workflow/bucket thực tế. Transaction dùng quyền PutItem và ConditionCheckItem, không có IAM action riêng tên TransactWriteItems.
3. Cấp backend `states:DescribeStateMachine`, `states:StartExecution` trên đúng workflow; `s3:GetObject`, `s3:GetObjectVersion` trên prefix uploads. Giữ các quyền upload/metadata/audit cũ.
4. Đặt `MAYSEC_SCAN_PIPELINE_ENABLED=true`, `MAYSEC_STORAGE_MODE=s3`, `MAYSEC_METADATA_MODE=dynamodb`, `MAYSEC_RESCAN_STATE_MACHINE_ARN=<ARN thực tế của workflow STANDARD ở ap-southeast-2>` rồi restart backend. ARN chưa cấu hình thì nút quét lại bị vô hiệu hóa.

Chỉ nhận tệp `upload_state=uploaded`, trạng thái `safe/error/unscanned/not_started`. Không nhận `scanning`, `flagged`, `quarantined`, `quarantine_delete_failed`: không có chức năng giải phóng/khôi phục cách ly trong thay đổi này. Quét lại chỉ đọc bản nguồn trong bucket Upload, xác minh dung lượng và version; không tự copy tệp cách ly về bucket thường.

Mỗi lượt mới có execution ARN/token riêng, chặn xem/tải bằng trạng thái scanning ngay khi nhận và xóa summary cũ. Compare-and-set ngăn hai lượt cùng nhận. Mỗi tệp chờ ít nhất 60 giây giữa hai yêu cầu mới; retry cùng token không tạo lượt mới. StartExecution dùng tên/input ổn định. Lỗi khởi chạy/timeout giữ scanning + dispatch unknown để không coi một lượt có thể đã chạy là thất bại; phản hồi báo lỗi để người vận hành sửa quyền/cấu hình rồi xác nhận lại. Nút **Xác nhận lượt quét** dùng lại token từ API, kể cả sau reload. Request đã started không tạo lại execution; timeout đến muộn không hạ started về unknown.

Thông báo SNS/webhook vẫn giữ bằng chứng giao nhận theo tệp/version để không gửi lại mù quáng. Lượt quét lại không reset các trạng thái sent/sending/unknown cũ; muốn thông báo riêng theo từng lượt cần mở rộng hợp đồng notification.

Source Lambda hiện quét CCCD và số thẻ, có OCR ảnh/PDF. `extraction_complete=null` là chưa có bằng chứng, không suy ra đã đọc đủ. Metadata cũ có tổng phát hiện nhưng chưa có breakdown vẫn hiển thị tổng và nhãn chưa có thống kê đầy đủ theo loại. Không tự coi tệp lỗi/unsupported/đọc thiếu là an toàn.

## Kiểm tra

`backend/tests/test_quota_scan.py` chạy route và repository trực tiếp với client giả, kiểm tra quota đồng thời, reservation chưa rõ kết quả, dữ liệu cũ nhiều trang, lease bị tiếp quản, local restart/đồng thời, báo cáo không lộ PII, retry cùng execution, cooldown và guard stale execution. `frontend/scripts/quota-scan.test.mjs` kiểm contract; `frontend/e2e/quota-scan.spec.js` kiểm sidebar, panel hai theme, chặn nội dung khi quét lại và retry sau reload. Các kiểm tra này không triển khai hoặc gọi AWS thật.

Tham chiếu: [DynamoDB transaction IAM](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html), [Step Functions StartExecution](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartExecution.html).

# BÀN GIAO AWS — BẢN NGẮN GỌN

MâySec · v2.1 · 31/10/2026

Code đã sẵn sàng ở local; chưa triển khai hay thay quyền trên AWS. Tab này hướng dẫn cài đặt; phụ lục tóm tắt quyền, dữ liệu và xử lý lỗi. JSON policy và source đầy đủ nằm trong gói ZIP.

## 1. Cần bổ sung gì trên AWS?

- IAM backend: bổ sung quyền quota, lịch sử/thông báo và xóa mọi phiên bản tệp ở cả Upload lẫn Quarantine. Cấp quyền gọi workflow STANDARD để bật Quét lại.

- Ba Lambda hiện có: cập nhật Scan, Quarantine và Notify để ghi báo cáo quét, chặn kết quả của lượt quét cũ và bỏ qua tệp trong Thùng rác.

- Workflow/S3: đối chiếu Step Functions, truyền ctx.execution đến cả ba Lambda; kiểm versioning và luồng S3 → EventBridge → workflow.

- Thêm Lambda securedrive-trash-cleanup, execution role riêng và lịch dọn mỗi giờ. Tệp ở Thùng rác được giữ 30 ngày.

- Backend: cập nhật source, bucket cách ly và ARN workflow rồi restart. Không cần tạo lại ba bảng DynamoDB hoặc đổi object key khi đổi tên.

### Kết quả kiểm tra profile

securedrive-key → IAM user securedrive-db-dev, account 018913575473. Đã xác nhận bị từ chối s3:ListBucketVersions trên cả hai bucket. Đọc DynamoDB thành công; quyền ghi/xóa, cấu hình Lambda/workflow chưa xác minh do thiếu quyền kiểm tra. Chưa xác nhận tiến trình FastAPI đang dùng chính profile này.

### Hành vi cần giữ

Quota 1 GB = 1.000.000.000 byte/owner; mỗi tệp tối đa 100 MB. Tệp trong rác vẫn tính quota; chỉ giảm khi xóa hết nội dung thành công. Đổi tên chỉ đổi tên hiển thị. Hiện dùng owner dev-user, chưa có đăng nhập thật.

Upload 100 MB không đồng nghĩa mọi tệp đều quét được: Scan mặc định tối đa 52.428.800 byte, OCR ảnh 10 MiB. Báo cáo hiển thị loại/số lượng dữ liệu nhạy cảm; không phải quét mã độc.

## 2. Cài đặt trên AWS Console

Nhận MaySec_AWS_Handoff_2026-10-31_v2.1.zip và file .sha256 qua kênh của nhóm. Giải nén; đường dẫn dưới tính từ gốc gói. Gói chỉ giữ trên máy, không có ZIP trên Drive. Sao lưu code/config/policy hiện tại và chờ lượt xử lý đang chạy kết thúc.

### Bước 1 · Bổ sung IAM backend

IAM → user/role chạy backend → Permissions → Add permissions → Create inline policy → JSON. Dùng AWS/IAM/securedrive-db-dev-runtime-018913575473.json; kiểm tên bucket trước khi lưu. securedrive-key dùng user securedrive-db-dev. Giữ quyền KMS đang cần.

Để quét lại: điền ARN thật vào AWS/IAM/securedrive-backend-quota-rescan-policy.example.json, cấp states:DescribeStateMachine và states:StartExecution. Không cần cấp quyền quản trị IAM/Lambda cho tài khoản ứng dụng.

### Bước 2 · Cập nhật ba Lambda

Lambda → từng hàm → Code → Upload from → .zip file → chọn gói cùng tên trong AWS/build/: securedrive-scan-pii.zip, securedrive-quarantine-file.zip, securedrive-notify.zip. Không upload ZIP bàn giao tổng. Cả ba dùng Handler=handler.lambda_handler, có handler.py và pipeline_common.py ở gốc.

Chung: FILES_TABLE=securedrive-files; AUDIT_TABLE=securedrive-audit-log. Scan: STRICT_DB_WRITE=true, giữ layer PDF/Textract. Quarantine: đúng QUARANTINE_BUCKET và KMS_KEY_ID. Notify: đúng SNS_TOPIC_ARN, webhook nếu dùng. Giữ/đối chiếu execution role, Logs, runtime/layer và timeout; ZIP không tự cập nhật các phần này.

### Bước 3 · Kiểm workflow và S3

Step Functions: workflow phải là STANDARD; đối chiếu AWS/Orchestration/State_machine.json và ctx.execution. Chỉ sửa khi cloud khác hợp đồng. S3: xác nhận bucket/region, versioning và EventBridge. Gửi ARN workflow thật cho backend; giữ rescan tắt đến khi ba Lambda và quyền đã sẵn sàng.

### Bước 4 · Thêm Lambda dọn rác

Tạo/cập nhật securedrive-trash-cleanup; upload AWS/build/securedrive-trash-cleanup.zip. Python 3.12; handler.lambda_handler; cấu hình thử 512 MB, timeout 300 giây. Env: FILES_TABLE, UPLOAD_BUCKET, QUARANTINE_BUCKET đúng tài nguyên thật. Không đặt AWS_PROFILE hoặc ghi đè AWS_REGION trên Lambda.

Role riêng tin cậy lambda.amazonaws.com, có Logs và AWS/IAM/securedrive-trash-cleanup-policy.example.json đã điền account/bucket. Lịch: AWS/Orchestration/trash-cleanup-schedule.example.yaml, rate(1 hour), có quyền invoke. Template mặc định State: DISABLED; nghiệm thu xong mới bật. Không dùng DynamoDB TTL để xóa metadata rác.

## 3. Cài backend và kiểm tra

Máy backend cần Python 3 và profile AWS (server dùng IAM role thì bỏ profile). Với repo đầy đủ, MaySec.cmd nhận bucket cách ly ở menu 3 → 5, ARN ở 3 → 9; Local/Demo tắt quét lại. Nếu chạy trực tiếp, từ backend/ cài:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Copy .env.example thành .env nếu chưa có; nếu đã có thì sửa tại chỗ. Chốt các giá trị dưới với bên AWS; thay phần <...> bằng tài nguyên thật:

```dotenv
AWS_PROFILE=securedrive-key
MAYSEC_STORAGE_MODE=s3
MAYSEC_METADATA_MODE=dynamodb
MAYSEC_SCAN_PIPELINE_ENABLED=true
MAYSEC_MAX_FILE_SIZE_BYTES=100000000
S3_BUCKET_NAME=<bucket Upload>
MAYSEC_QUARANTINE_BUCKET_NAME=<bucket Quarantine>
AWS_REGION=<region S3 đã xác nhận>
DYNAMODB_REGION=ap-southeast-2
DYNAMODB_FILES_TABLE=securedrive-files
DYNAMODB_AUDIT_TABLE=securedrive-audit-log
DYNAMODB_USERS_TABLE=securedrive-users
MAYSEC_RESCAN_STATE_MACHINE_ARN=<ARN STANDARD thật>
```

Trên server dùng IAM role thì bỏ AWS_PROFILE. Để ARN trống nếu chưa bật quét lại. Không ghi key/secret vào gói. Biến terminal/service có thể ghi đè .env; đối chiếu cấu hình tiến trình trước restart.

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --env-file .env
```

Restart mọi worker. GET /health: storage=s3, metadata_mode=dynamodb; storage_quota, scan_report, file_lifecycle, persistent_activity=true; rescan=true khi ARN/quyền hợp lệ. Health chỉ là kiểm cấu hình; cần thử thao tác thật. Frontend phát hành từ repository đầy đủ, trỏ API backend đúng.

### Nghiệm thu trước khi bật lịch

- Upload mẫu sạch/nhạy cảm: trạng thái, báo cáo, cách ly đúng; giới hạn 100 MB/tệp và quota 1 GB được thực thi. Quét lại tạo lượt mới; Cập nhật trạng thái chỉ đọc.

- Đổi tên rồi reload; chuyển rác/khôi phục giữ kết quả quét và quota. Xóa vĩnh viễn hết version/marker ở hai bucket; chỉ lúc đó quota giảm. Lỗi xóa giữ trạng thái để thử lại.

- Reload vẫn có lịch sử upload/thông báo, kể cả lịch sử tệp đã xóa. Dùng mẫu test hết hạn để thử cleanup; giữ tệp chưa hết hạn/đã khôi phục. Đạt rồi mới Enable lịch.

Bàn giao lại: policy đã gắn; tên bucket/region; ARN workflow; version/checksum của bốn Lambda; ARN/trạng thái lịch; kết quả kiểm thử và mục còn lỗi. Khi cần rollback: tắt lịch/quét lại, khôi phục code/config đã sao lưu; xóa nội dung vĩnh viễn không hoàn tác.

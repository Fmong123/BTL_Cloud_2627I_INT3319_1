# Source và cấu hình AWS của MaySec

Toàn bộ mã Lambda, policy IAM và định nghĩa Step Functions của dự án nằm trong thư mục này. Backend FastAPI nằm trong `../backend/`; backend không import trực tiếp các handler Lambda.

## Cấu trúc

```text
AWS/
├── IAM/
│   ├── securedrive-lambda-s3-read.json
│   ├── securedrive-scan-pii-policy.json
│   ├── securedrive-quarantine-inline-policy.json
│   ├── securedrive-notify-lambda-policy.json
│   └── securedrive-sfn-dynamodb-policy.json
├── Lambda_AWS/
│   ├── pipeline_common.py
│   ├── scan_file/
│   │   └── handler.py
│   ├── quarantine/
│   │   └── handler.py
│   └── notification/
│       └── handler.py
├── Orchestration/
│   └── State_machine.json
├── scripts/build_packages.py
├── tests/test_pipeline.py
├── DEPLOYMENT.md
└── README.md
```

## Source và tên hàm trên AWS

| Source | Tên hàm AWS được workflow gọi | Handler khi đóng gói như bên dưới |
|---|---|---|
| [Scan](Lambda_AWS/scan_file/handler.py) | `securedrive-scan-pii` | `handler.lambda_handler` |
| [Quarantine](Lambda_AWS/quarantine/handler.py) | `securedrive-quarantine-file` | `handler.lambda_handler` |
| [Notification](Lambda_AWS/notification/handler.py) | `securedrive-notify` | `handler.lambda_handler` |

Đóng gói riêng từng Lambda. Mỗi ZIP bắt buộc có **cả `handler.py` và `pipeline_common.py` ở gốc**. Dùng [script đóng gói](scripts/build_packages.py), không nén nguyên thư mục `AWS/`. Nếu sửa bằng Lambda Console, tạo đủ hai module và cấu hình `handler.lambda_handler`. Đối chiếu code đang chạy trước khi triển khai để tránh ghi đè bản mới hơn. Xem [hướng dẫn triển khai và hợp đồng cập nhật](DEPLOYMENT.md).

Việc chuyển thư mục trong repo không tự đổi tên hàm AWS, IAM role, ARN hoặc trigger. [State machine](Orchestration/State_machine.json) vẫn gọi ba tên hàm trong bảng trên. Khi triển khai ZIP có module mới, cập nhật cấu hình handler nếu bản đang chạy dùng tên module khác.

## Cấu hình Lambda

Tên biến bên dưới lấy từ source hiện có; biến của backend không tự được truyền sang Lambda.

| Lambda | Biến môi trường |
|---|---|
| Scan | `FILES_TABLE`, `AUDIT_TABLE`, `STRICT_DB_WRITE`, `MAX_SCAN_BYTES`, `MAX_FINDINGS`, `MIN_PDF_TEXT_CHARS`, `CREDIT_CARD_LUHN` |
| Quarantine | Bắt buộc: `QUARANTINE_BUCKET`, `KMS_KEY_ID`; tên bảng: `FILES_TABLE`, `AUDIT_TABLE` |
| Notification | Bắt buộc: `SNS_TOPIC_ARN`; tên bảng: `FILES_TABLE`, `AUDIT_TABLE`; `WEBHOOK_URL` nếu dùng webhook |

Tên bảng mặc định của các Lambda là `securedrive-files` và `securedrive-audit-log`. Kiểm tra đúng region và tài nguyên thực tế trước khi triển khai. Scan dùng Boto3; `pypdf` là thư viện tùy chọn để trích xuất PDF trực tiếp, có thể được đóng gói hoặc cung cấp qua layer. Khi không có `pypdf`, source Scan chuyển sang OCR cho PDF. Cần đối chiếu dependency, timeout, bộ nhớ và quyền Textract với phương án triển khai thực tế.

## IAM và workflow

| File | Mục đích |
|---|---|
| [securedrive-lambda-s3-read.json](IAM/securedrive-lambda-s3-read.json) | Policy đọc S3 riêng có sẵn; đối chiếu role đang dùng trước khi gắn thêm vì policy Scan cũng có quyền đọc nguồn. |
| [securedrive-scan-pii-policy.json](IAM/securedrive-scan-pii-policy.json) | Quyền đọc nguồn, OCR và ghi kết quả/audit của Scan. |
| [securedrive-quarantine-inline-policy.json](IAM/securedrive-quarantine-inline-policy.json) | Quyền copy, kiểm tra, xóa phiên bản nguồn, KMS và ghi DB của Quarantine. |
| [securedrive-notify-lambda-policy.json](IAM/securedrive-notify-lambda-policy.json) | Quyền SNS, audit và trạng thái gửi riêng từng kênh trong bảng files. |
| [securedrive-sfn-dynamodb-policy.json](IAM/securedrive-sfn-dynamodb-policy.json) | Giữ quyền DB cũ cho lúc chuyển phiên bản; bổ sung quyền gọi ba Lambda. Workflow mới gọi writer của Lambda cho nhánh lỗi để ghi đủ metadata và audit. |
| [State_machine.json](Orchestration/State_machine.json) | Định nghĩa workflow gọi Scan, Quarantine và Notification. |

Các policy này là những phần cấu hình hiện có trong repo; không mặc nhiên bao gồm đầy đủ trust policy, quyền ghi log, quyền gọi Lambda của Step Functions, quyền khởi chạy workflow của EventBridge hoặc key policy KMS. Kiểm tra role và cấu hình thực tế trước khi áp dụng. ARN trong JSON phải khớp tài nguyên của môi trường triển khai.

## Kiểm tra sau triển khai

- [Hợp đồng API](../docs/api-contract.md) và [schema DynamoDB](../docs/dynamodb-item-schema.md).
- [Kiểm thử pipeline toàn luồng](../docs/aws-pipeline-e2e-test-guide.md).
- [Kiểm thử thủ công](../docs/aws-pipeline-manual-test-guide.md).

Source đã bổ sung audit có owner, tổng phát hiện đầy đủ, đọc đúng phiên bản S3, điều kiện cập nhật metadata, trạng thái cách ly và theo dõi gửi theo kênh. Scan mặc định yêu cầu `STRICT_DB_WRITE=true`, metadata tồn tại và nguồn có version ID. Các sửa đổi đang ở repo, chưa được triển khai lên AWS. Backend/API và cơ chế owner `dev-user` hiện tại được giữ nguyên; Cognito chưa được tích hợp.

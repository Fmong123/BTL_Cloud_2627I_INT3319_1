# Tham chiếu cấu hình

Nguồn chuẩn: [Settings](../../backend/app/config.py), [backend/.env.example](../../backend/.env.example), [frontend/.env.example](../../frontend/.env.example) và các handler Lambda. Cách chọn chế độ tại [local](../guides/local-development.md).

## Nạp và ưu tiên

Backend chạy trực tiếp dùng uvicorn --env-file .env; biến terminal/service ưu tiên file. Đổi config restart mọi worker. AWS CLI không tự đọc backend/.env. Boto3 dùng credentials chain; AWS_PROFILE là tên profile local, bỏ khi dùng IAM role.

Vite nạp các file ENV theo mode; biến terminal ưu tiên. VITE_* được đưa vào bundle, không chứa secret. Đổi xong restart Vite hoặc build/phát hành lại. Cấu hình kết nối được lưu trong browser còn chịu quy tắc scope của API client.

Launcher có thứ tự riêng: mặc định → ENV → terminal → giá trị lưu → chế độ/giá trị đồng bộ; xem [launcher](../../launcher/README.md). Không ghi đè ENV gốc bằng override launcher.

## Backend

| Biến | Mặc định code | Ý nghĩa/ràng buộc |
| --- | --- | --- |
| MAYSEC_STORAGE_MODE | unconfigured | unconfigured/local/s3 |
| MAYSEC_LOCAL_STORAGE_DIR | data | Tương đối từ backend/; Local |
| MAYSEC_MAX_FILE_SIZE_BYTES | 100000000 | Dương; lớn hơn bị chặn ở trần 100 MB |
| MAYSEC_CORS_ORIGINS | localhost và 127.0.0.1:5173, HTTP | Danh sách origin phân cách dấu phẩy |
| MAYSEC_METADATA_MODE | disabled | disabled/dynamodb |
| MAYSEC_AUTH_MODE | cognito | cognito/dev; dev cấm S3 |
| MAYSEC_DEV_ROLE | user | user/admin, chỉ chế độ dev |
| COGNITO_USER_POOL_ID | Trống | Pool cấp token/directory |
| COGNITO_APP_CLIENT_ID | Trống | App client được phép |
| MAYSEC_DEMO_LOGIN_ENABLED | false | Bật bộ chọn không mật khẩu; cần cognito + Pool |
| MAYSEC_DEMO_SIGNING_KEY | Trống | Nếu có, ít nhất 32 ký tự; chia sẻ giữa worker |
| MAYSEC_SCAN_PIPELINE_ENABLED | false | true chỉ cho S3 + DynamoDB; không tự bật/tắt EventBridge cloud |
| MAYSEC_RESCAN_STATE_MACHINE_ARN | Trống | ARN STANDARD không alias/version ở ap-southeast-2; chỉ khi pipeline bật |
| MAYSEC_QUARANTINE_BUCKET_NAME | Trống | Đúng bucket Lambda cách ly; dùng đọc/purge |
| DYNAMODB_REGION | ap-southeast-2 | Code cố định Sydney khi metadata bật |
| DYNAMODB_FILES_TABLE | securedrive-files | Bắt đầu securedrive- |
| DYNAMODB_AUDIT_TABLE | securedrive-audit-log | Bắt đầu securedrive- |
| DYNAMODB_USERS_TABLE | securedrive-users | Bắt đầu securedrive- |
| S3_BUCKET_NAME | Trống | Bắt buộc khi storage=s3 |
| AWS_REGION | Trống | Region S3; bắt buộc khi s3, độc lập region DB |
| MAYSEC_S3_MULTIPART_THRESHOLD_BYTES | 16777216 | Ngưỡng SDK 16 MiB |
| MAYSEC_S3_MULTIPART_CHUNKSIZE_BYTES | 8388608 | Chunk 8 MiB; code cho 5 MiB..5 GiB |
| MAYSEC_S3_MAX_CONCURRENCY | 2 | Số tác vụ SDK mỗi upload, phải dương |
| AWS_PROFILE | Credentials chain | Tên profile phát triển, không phải access key |

Mặc định code khác giá trị mẫu: .env.example có sẵn Pool/client định danh công khai và AWS_PROFILE của môi trường nhóm. Muốn Local không AWS phải xóa các giá trị Cognito và tắt demo theo README. Backend nhận boolean true/false/1/0.

Không có ENV sửa giá. [billing-policy.json](../../backend/app/assets/billing-policy.json) nạp khi khởi động; thay chính sách cần phiên bản/lịch áp dụng theo [chính sách chi phí](../policies/billing.md).

## Frontend

| Biến | Hành vi |
| --- | --- |
| VITE_UPLOAD_MODE | demo/api; mẫu là demo |
| VITE_API_BASE_URL | Mẫu http://127.0.0.1:8000; bỏ biến: dev dùng địa chỉ đó, build dùng cùng origin + /api |
| VITE_MAX_FILE_SIZE_MB | Mẫu 100; MB thập phân; API có thể hạ trần |
| VITE_COGNITO_DOMAIN | Domain cho Authorization Code + PKCE |
| VITE_COGNITO_APP_CLIENT_ID | App client web; phải khớp pool/cấu hình cho phép |
| VITE_COGNITO_REDIRECT_URI | Trống dùng origin + /callback |
| VITE_COGNITO_LOGOUT_URI | Trống dùng origin hiện tại |

Bộ chọn demo không cần VITE_COGNITO_*. Deploy sau proxy dùng /api hoặc URL HTTPS thật; không đưa loopback máy phát triển vào bundle cloud. Proxy bỏ prefix /api, hỗ trợ callback và body lớn hơn 100 MB để đủ overhead multipart.

## Lambda và workflow

| Thành phần | Biến / mặc định source |
| --- | --- |
| Scan, Quarantine, Notify | FILES_TABLE=securedrive-files, AUDIT_TABLE=securedrive-audit-log |
| Scan | STRICT_DB_WRITE=true, MAX_SCAN_BYTES=100000000, MIN_PDF_TEXT_CHARS=1, MAX_OCR_FRAMES=50, MAX_FINDINGS=500, CREDIT_CARD_LUHN=false |
| Quarantine | QUARANTINE_BUCKET, KMS_KEY_ID; phải là tài nguyên thật |
| Notify | SNS_TOPIC_ARN; không còn đọc WEBHOOK_URL |
| Cleanup | FILES_TABLE, AUDIT_TABLE, UPLOAD_BUCKET, QUARANTINE_BUCKET |

Backend dùng DYNAMODB_*_TABLE, Lambda dùng FILES_TABLE/AUDIT_TABLE; phải cùng bảng. Bucket cách ly backend phải khớp QUARANTINE_BUCKET. AWS_REGION do runtime Lambda cung cấp; không đặt profile/credentials local lên Lambda.

Scan có hằng số MAX_OCR_IMAGE_BYTES=10*1024*1024, không phải ENV. MAX_SCAN_BYTES 100 MB không nâng giới hạn OCR ảnh. ZIP Scan kèm dependency native phải khớp Python 3.12 Linux x86_64. Runtime/memory/timeout và quyền đặt theo [triển khai AWS](../operations/aws-deployment.md).

Workflow source tại [State_machine.json](../../AWS/Orchestration/State_machine.json), STANDARD, RouteOperation/RecoveryQuarantine/RecoveryNotify/PersistQuarantineFailure. Lịch cleanup mẫu rate(1 hour), mặc định DISABLED. Source/ENV mới không tự thay tài nguyên AWS.

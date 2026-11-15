# Phát triển và chạy local

Nguồn: [Settings](../../backend/app/config.py), [ENV backend](../../backend/.env.example), [ENV frontend](../../frontend/.env.example), [package.json](../../frontend/package.json). Cài venv, dependency và chạy hai server theo [README](../../README.md#chạy-trên-windows).

## Chọn chế độ

| Chế độ | Cấu hình backend | Kết quả |
| --- | --- | --- |
| Demo frontend | Upload mode demo | Mô phỏng byte/tệp trong trình duyệt, không gửi upload tới API |
| Local | storage=local, metadata=disabled, auth=dev, pipeline=false | Ghi byte thật, chưa có thư viện/quét server |
| Local + DB | storage=local, metadata=dynamodb, pipeline=false | Nội dung local, metadata/quota/lifecycle DB |
| S3 + DB | storage=s3, metadata=dynamodb, auth=cognito | Nội dung S3, thư viện/quota server, quét khi pipeline AWS sẵn sàng |

Demo upload là lựa chọn mô phỏng byte của workspace, khác bộ chọn tài khoản Cognito. Khi VITE_UPLOAD_MODE=demo, màn hình login có **Trải nghiệm giao diện · không lưu lên AWS** để vào giao diện mô phỏng; đăng nhập Local/Cognito thật vẫn cần API xác thực tương ứng.

Local + DB cần credentials DynamoDB thật. Dọn ARN rescan khi pipeline tắt. S3 bắt buộc Cognito; Local có thể dùng Cognito nếu cần danh tính thật. Local + DB vẫn chịu giới hạn đĩa của adapter Local.

## Cấu hình backend

Từ backend/, tạo .env từ .env.example nếu chưa có; giữ file riêng đang dùng. Các tổ hợp Local không AWS nằm trong README. Để Local hoàn toàn độc lập AWS, để trống User Pool/App client, tắt demo login và pipeline.

Với S3, sửa đúng các biến tương ứng trong .env:

```dotenv
MAYSEC_STORAGE_MODE=s3
MAYSEC_METADATA_MODE=dynamodb
MAYSEC_AUTH_MODE=cognito
COGNITO_USER_POOL_ID=<User Pool thực tế>
COGNITO_APP_CLIENT_ID=<App client thực tế>
S3_BUCKET_NAME=<bucket nguồn>
MAYSEC_QUARANTINE_BUCKET_NAME=<bucket cách ly>
AWS_REGION=<region bucket>
DYNAMODB_REGION=ap-southeast-2
DYNAMODB_FILES_TABLE=securedrive-files
DYNAMODB_AUDIT_TABLE=securedrive-audit-log
DYNAMODB_USERS_TABLE=securedrive-users
MAYSEC_SCAN_PIPELINE_ENABLED=false
MAYSEC_RESCAN_STATE_MACHINE_ARN=
```

Dùng AWS_PROFILE trên máy phát triển; bỏ khi server dùng IAM role. Sau [triển khai/nghiệm thu AWS](../operations/aws-deployment.md), mới bật pipeline và điền ARN STANDARD phù hợp.

Chạy từ backend/:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --env-file .env
```

Biến terminal/service ưu tiên .env. Restart mọi worker khi đổi config. /health xác nhận cấu hình/client, không chứng minh quyền IAM. GET / không có trang web.

## Frontend và launcher

Từ frontend/, cài bằng `pnpm.cmd install --frozen-lockfile`, chạy `pnpm.cmd run dev --port 5173 --strictPort`. Chọn kết nối API trong web hoặc sửa frontend/.env.local:

```dotenv
VITE_UPLOAD_MODE=api
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_MAX_FILE_SIZE_MB=100
```

Tùy chọn trong trình duyệt được giữ sau reload. Đổi VITE_* cần restart Vite/build lại. Web HTTPS cần backend HTTPS; CORS phải khớp origin. Khi deploy cùng hostname dùng /api; proxy bỏ prefix trước chuyển tới FastAPI.

MaySec.cmd quản lý hai server và đồng bộ cấu hình. Xem [launcher](../../launcher/README.md) về thứ tự ENV/override, log, khởi động lại và dừng tiến trình.

## Xử lý lỗi

| Hiện tượng | Kiểm tra |
| --- | --- |
| 401 / 403 | Access token, nhóm và trạng thái tài khoản |
| Auth 503 | Pool/client, JWKS, config hiệu lực |
| Upload 503 | Storage/metadata/profile/role; S3 cần DB quota |
| Upload 413 | Trần tệp hoặc quota gồm reservation |
| Rescan bị tắt | S3 pipeline, ARN STANDARD, quyền workflow và restart |
| Purge chưa xong | Bucket cách ly, quyền list/xóa version ở cả hai bucket |
| Config khác .env | Terminal/service hoặc launcher override |
| Upload unknown | Đối soát ID, metadata và storage trước gửi lại |
| SNS sending/unknown | [Đối soát pipeline](../operations/pipeline-recovery.md), không tự gửi lại |

Danh sách ENV tại [tham chiếu cấu hình](../reference/configuration.md). Kiểm tra chức năng/build/test theo [nghiệm thu](../operations/testing.md).

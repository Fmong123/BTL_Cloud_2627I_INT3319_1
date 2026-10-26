# Backend API MaySec

Backend hiện có FastAPI, upload multipart, validation/CORS, adapter local ghi file thật và interface để ghép S3. Chế độ mặc định chưa cấu hình trả 503 với upload hợp lệ.

**Hướng dẫn đầy đủ:** [api-guide.md](../docs/api-guide.md) — cài đặt, cấu hình, endpoint, Swagger/curl, kết nối webapp, vị trí lưu file, kiểm thử, xử lý lỗi và bàn giao teammate.

**Hợp đồng request/response:** [api-contract.md](../docs/api-contract.md).

**DynamoDB đã ghép theo cấu hình:** metadata bật thì `/upload` ghi metadata/audit; đã có GET /files và GET /files/{id}/status. Xem [test API local trước](../docs/dynamodb-fastapi-local-test-guide.md) và [test repository riêng](../docs/dynamodb-service-test-guide.md). Owner cố định dev-user, chưa có auth. Pytest không gọi AWS; test cloud là thao tác riêng.

## Chạy nhanh bằng PowerShell

Các lệnh dùng vị trí clone hiện tại; thay đường dẫn nếu clone ở nơi khác. Tạo venv và cài dependencies một lần:

```powershell
Set-Location 'G:\code\BTL_Cloud_2627I_INT3319_1\backend'
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Mỗi lần chạy API local:

```powershell
$env:MAYSEC_STORAGE_MODE = 'local'
$env:MAYSEC_METADATA_MODE = 'disabled'
$env:MAYSEC_SCAN_PIPELINE_ENABLED = 'false'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Mở `/docs` hoặc `/health` trên port 8000. Webapp ở port 5173; API chưa có giao diện tại GET `/`. Local adapter mặc định ghi `backend/data/<key>`; xem phần cấu hình trong hướng dẫn nếu thay storage root.

Ctrl+C để dừng. Đổi config phải restart. Uploader của Sang đã nối vào `app.main:app` theo [contract](../docs/api-contract.md). Chọn s3 yêu cầu S3_BUCKET_NAME, AWS_REGION và quyền AWS. MAYSEC_SCAN_PIPELINE_ENABLED=true chỉ hợp lệ với S3 + DynamoDB; metadata khởi tạo scanning, pipeline chạy nhờ S3/EventBridge, API không gọi Lambda trực tiếp. API đọc đủ trạng thái/summary theo bàn giao mới; phần ghi DB của Lambda vẫn cần nghiệm thu riêng. Chưa có auth/download; upload thành công không chứng minh đã quét.

**Tự kiểm tra local/S3 và đối chiếu SHA256:** [upload-test-guide.md](../docs/upload-test-guide.md).

## Cấu hình bằng .env và AWS profile

[.env.example](.env.example) có giải thích từng biến và ba cách chạy. Chỉ copy lần đầu nếu chưa có .env; không ghi đè cấu hình đang dùng. Với bước test file local + DynamoDB hiện tại, sửa các dòng trong backend/.env:

```dotenv
AWS_PROFILE=securedrive-key
MAYSEC_STORAGE_MODE=local
MAYSEC_METADATA_MODE=dynamodb
MAYSEC_SCAN_PIPELINE_ENABLED=false
DYNAMODB_REGION=ap-southeast-2
```

Giữ ba tên bảng securedrive- như mẫu. AWS_PROFILE là tên profile đã cấu hình trên máy, không phải access key; Boto3 đọc trực tiếp từ môi trường sau khi Uvicorn nạp .env. Credentials ở %USERPROFILE%\.aws\credentials. Không cần sửa app/config.py để SDK nhận profile. Khi triển khai dùng IAM role, bỏ cấu hình profile local. [Tài liệu Boto3](https://docs.aws.amazon.com/boto3/latest/guide/configuration.html).

Từ backend/, chạy:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --env-file .env
```

Không cần đặt lại $env:AWS_PROFILE mỗi lần nếu đã có trong .env và nạp đúng lệnh trên. Biến terminal đang tồn tại vẫn được ưu tiên; mở terminal mới hoặc xóa riêng biến cũ nếu sửa .env chưa có hiệu lực. Nếu terminal có AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_SESSION_TOKEN, credentials trực tiếp có thể được ưu tiên hơn profile; không in các giá trị đó để debug.

AWS CLI không tự đọc .env. Kiểm tra danh tính bằng `aws sts get-caller-identity --profile securedrive-key --no-cli-pager`; account nhóm là 018913575473. Cấu hình AWS chỉ ở backend; frontend dùng frontend/.env.local với VITE_UPLOAD_MODE=api và URL backend.

## Kiểm thử

Từ thư mục `backend/`:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe scripts/check_local_api.py
```

Pytest dùng adapter giả/local, không gọi AWS. Script check_local_api tự chạy HTTP local thật, kiểm 8 bước và dừng server, không bật AWS. Không commit .venv, .env, dữ liệu upload hoặc cache. Xem [hướng dẫn local](../docs/dynamodb-fastapi-local-test-guide.md) để bật DB thật như một bước riêng.

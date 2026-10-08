# Backend API MaySec

Backend hiện có FastAPI, upload multipart, validation/CORS, adapter local ghi file thật và interface để ghép S3. Chế độ mặc định chưa cấu hình trả 503 với upload hợp lệ.

**Hướng dẫn đầy đủ:** [api-guide.md](../docs/api-guide.md) — cài đặt, cấu hình, endpoint, Swagger/curl, kết nối webapp, vị trí lưu file, kiểm thử, xử lý lỗi và bàn giao teammate.

**Hợp đồng request/response:** [api-contract.md](../docs/api-contract.md).

## Chạy nhanh bằng PowerShell

Các lệnh dùng vị trí clone hiện tại; thay đường dẫn nếu clone ở nơi khác. Tạo venv và cài dependencies một lần:

```powershell
Set-Location 'D:\Cloud UET\MaySec\backend'
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Mỗi lần chạy API local:

```powershell
$env:MAYSEC_STORAGE_MODE = 'local'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Mở `/docs` hoặc `/health` trên port 8000. Webapp ở port 5173; API chưa có giao diện tại GET `/`. Local adapter mặc định ghi `backend/data/<key>`; xem phần cấu hình trong hướng dẫn nếu thay storage root.

Ctrl+C để dừng. Đổi config phải restart. Đã có adapter và factory/config S3; vẫn cần Sang triển khai uploader và nối vào `create_app(s3_uploader=upload_to_s3)` theo [contract](../docs/api-contract.md). Chọn `s3` yêu cầu `S3_BUCKET_NAME` và `AWS_REGION`; thiếu uploader thì upload trả 503. Chưa có auth, list/download, DB metadata hay pipeline quét; file upload thành công chưa được quét.

## Kiểm thử

Từ thư mục `backend/`:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q
```

Test dùng adapter giả/local, không gọi AWS. Không commit `.venv`, `.env`, dữ liệu upload hoặc cache.

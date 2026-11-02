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

Ctrl+C để dừng. Đổi config phải restart. Uploader của Sang đã nối vào `app.main:app` theo [contract](../docs/api-contract.md). Chọn `s3` yêu cầu `S3_BUCKET_NAME`, `AWS_REGION` và quyền AWS của backend. Đã tích hợp xác thực Amazon Cognito JWT. Chưa có list/download, DB metadata hay pipeline quét; file upload thành công chưa được quét.

**Tự kiểm tra local/S3 và đối chiếu SHA256:** [upload-test-guide.md](../docs/upload-test-guide.md).

## Xác thực Amazon Cognito (JWT)

- **Cách xác thực:** Client gửi `Authorization: Bearer <access_token>` trong header HTTP. Access token được cấp qua luồng Cognito Hosted UI (Authorization Code + PKCE). Backend xác thực chữ ký RS256 và claims qua bộ khóa JWKS của User Pool mà không bao giờ nhận mật khẩu.
- **Mã lỗi chuẩn:**
  - `401 Unauthorized`: Thiếu header Authorization, token sai định dạng, token hết hạn, sai issuer hoặc client_id. Luôn kèm header `WWW-Authenticate: Bearer`.
  - `403 Forbidden`: Token hợp lệ nhưng người dùng không thuộc nhóm được phép trong `cognito:groups` (`admin` hoặc `user`).
  - `503 Service Unavailable`: Dịch vụ xác thực chưa được cấu hình (thiếu User Pool ID / App Client ID) hoặc không thể kết nối tới JWKS của Cognito.
- **Chế độ Dev (`MAYSEC_AUTH_MODE=dev`):**
  - Dành riêng cho phát triển cục bộ mà không cần kết nối tới Cognito. Mặc định gán `owner_id="dev-user"`, vai trò cấu hình qua `MAYSEC_DEV_ROLE=user` (hoặc `admin`).
  - **Giới hạn an toàn:** Nghiêm cấm chạy chế độ dev với S3 (`MAYSEC_STORAGE_MODE=s3`). Hệ thống sẽ ném lỗi `ValueError` ngay khi khởi tạo để ngăn chặn truy cập ngoài ý muốn vào S3 bằng danh tính giả lập.
- **Endpoint `GET /me`:**
  - Trả về JSON: `{"id": "<owner_id>", "role": "admin" | "user"}`.
  - Phục vụ frontend kiểm tra trạng thái phiên và hiển thị giao diện theo vai trò người dùng (không trả thông tin nhạy cảm hay email).

## Kiểm thử

Từ thư mục `backend/`:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q
```

Test dùng adapter giả/local, không gọi AWS. Không commit `.venv`, `.env`, dữ liệu upload hoặc cache.

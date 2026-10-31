# MâySec — kho lưu trữ và kiểm tra dữ liệu nhạy cảm

React/Vite + FastAPI + S3/DynamoDB, cùng Lambda và Step Functions xử lý quét/cách ly. Bản hiện tại dùng owner phát triển `dev-user`; chưa có đăng nhập nhiều tài khoản.

## Chức năng hiện có

- Sáu trang: Tổng quan, Tệp của tôi, Hoạt động xử lý, Thùng rác, Cài đặt, Hướng dẫn.
- Upload/kéo thả, tối đa 5 tệp song song; mỗi tệp tối đa **100 MB = 100.000.000 byte**.
- Quota **1 GB = 1.000.000.000 byte/owner**, tính cả tệp trong rác và dung lượng đang giữ chỗ.
- Danh sách từ API, tìm/lọc/sắp xếp, đánh dấu; xem ảnh/PDF/văn bản và tải xuống khi đủ điều kiện.
- Báo cáo quét, yêu cầu quét lại, đổi tên, khôi phục/xóa vĩnh viễn; lịch sử upload/thông báo giữ sau reload.
- Giao diện sáng/tối, sidebar thu gọn, chọn nhiều và panel chi tiết.

Upload thành công chỉ xác nhận đã lưu nội dung. Nội dung chỉ được xem/tải khi đã upload xong, kết quả quét `safe` và không trong rác. Quét hiện phát hiện CCCD và số thẻ, không phải quét mã độc.

## Chạy trên Windows

Nhấp đúp **MaySec.cmd** để chọn chế độ và khởi động. [Launcher](launcher/README.md) đọc cấu hình hiện có, đồng bộ port/CORS/giới hạn và quản lý tiến trình.

Chạy trực tiếp, từ thư mục gốc project:

```powershell
Set-Location backend
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Tạo `backend/.env` từ `.env.example` nếu chưa có; giữ file cấu hình riêng đang dùng. Với Local không AWS:

```dotenv
MAYSEC_STORAGE_MODE=local
MAYSEC_METADATA_MODE=disabled
MAYSEC_SCAN_PIPELINE_ENABLED=false
MAYSEC_RESCAN_STATE_MACHINE_ARN=
MAYSEC_MAX_FILE_SIZE_BYTES=100000000
```

Từ `backend/`, chạy:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --env-file .env
```

Terminal khác, từ `frontend/`:

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd run dev --port 5173 --strictPort
```

Frontend mặc định demo; chọn Lưu trữ thật và URL `http://127.0.0.1:8000` để dùng API. Local không metadata vẫn upload thật nhưng không có thư viện/quét trên server. S3 cần metadata DynamoDB để kiểm quota.

## Tài liệu cần đọc

| Công việc | Hướng dẫn |
| --- | --- |
| Cài backend và chọn chế độ | [API guide](docs/api-guide.md) |
| Endpoint, payload và giới hạn | [API contract](docs/api-contract.md); schema đang chạy tại /docs |
| Thao tác web và dữ liệu được ghi nhớ | [Frontend guide](docs/frontend-guide.md) |
| Cài/cập nhật AWS | [Bàn giao và cài đặt](docs/AWS-HANDOFF-QUICKSTART-2026-10-31.md) |
| Quyền và lưu ý kỹ thuật AWS | [Phụ lục](docs/AWS-HANDOFF-2026-10-31.md) |
| Source, builder Lambda | [AWS](AWS/README.md) |

## Kiểm tra

Backend, từ `backend/`:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q
```

Frontend, từ `frontend/`:

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:ui -- --project=chrome
```

Các lệnh test trên dành cho bản làm việc local còn giữ các thư mục hỗ trợ. Theo cấu hình .gitignore, scripts/tests/tools/e2e và cấu hình test không được đưa vào Git; bản clone mới chỉ có mã nguồn và cấu hình ứng dụng. Các test local dùng client giả/Moto hoặc API giả; không triển khai AWS. Không đưa .env thật, credentials, dữ liệu upload, venv hoặc node_modules vào Git/gói bàn giao.

.github/workflows/check.yml kiểm tra cú pháp Python và build frontend trên push/PR; không phụ thuộc các thư mục test local, không deploy và không cần credentials AWS.

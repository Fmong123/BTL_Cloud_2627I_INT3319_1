# MâySec

MâySec là hệ thống lưu trữ tài liệu và phát hiện dữ liệu nhạy cảm, xây dựng bằng React/Vite, FastAPI và AWS. Người dùng có không gian lưu trữ riêng; S3, EventBridge, Step Functions và Lambda xử lý quét CCCD/số thẻ, cách ly và gửi kết quả. Hệ thống hiện không quét mã độc.

## Chức năng chính

- Upload/kéo thả; quản lý tệp, thư mục nhiều cấp; tìm kiếm, lọc và đánh dấu yêu thích.
- Xem/tải nội dung khi đủ điều kiện, báo cáo quét và yêu cầu quét lại.
- Đổi tên, di chuyển, Thùng rác, khôi phục, xóa vĩnh viễn và cleanup hết hạn.
- Đăng nhập Cognito, Drive riêng theo tài khoản; đăng nhập trình diễn khi được bật ở backend.
- Lịch sử xử lý, chuông thông báo và theo dõi chi phí sử dụng ước tính.
- Quản trị tài khoản user, quota, báo cáo CSV/PDF, lịch sử quản trị, xem xét cách ly và phục hồi pipeline.
- Giao diện sáng/tối, hỗ trợ màn hình nhỏ.

Upload thành công xác nhận nội dung đã lưu. Quyền đọc còn phụ thuộc kết quả quét, vòng đời và quyết định xem xét cách ly. Quy tắc chi tiết nằm trong [tài liệu hệ thống](docs/README.md).

## Cấu trúc mã nguồn

```text
frontend/src/        React: trang, component, phiên đăng nhập, state và API client
backend/app/         FastAPI: router, schema, xác thực, storage và nghiệp vụ
AWS/Lambda_AWS/      Scan, Quarantine, Notify và Trash Cleanup
AWS/Orchestration/   Workflow Step Functions và mẫu lịch cleanup
AWS/IAM/             Policy mẫu theo từng principal/role
launcher/            Menu Windows, cấu hình và quản lý tiến trình
docs/                Chính sách, thiết kế, tham chiếu và hướng dẫn
MaySec.cmd           Điểm khởi động trên Windows
```

Luồng chính: **Frontend → FastAPI → S3 → EventBridge → Step Functions → Lambda → DynamoDB**. Frontend đọc trạng thái qua API. Xem [thiết kế hệ thống](docs/design/system.md).

## Chạy trên Windows

Cần Python 3.10+, Node.js và pnpm; CI hiện dùng Python 3.12, Node.js 24 và pnpm 10.

Nhấp đúp **MaySec.cmd**, kiểm tra môi trường, chọn chế độ rồi khởi động. Launcher đồng bộ port, URL API, CORS và giới hạn dung lượng. Xem [hướng dẫn launcher](launcher/README.md).

Để chạy trực tiếp Local không AWS, từ thư mục gốc:

```powershell
Set-Location backend
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
```

Sửa các giá trị tương ứng trong `backend/.env`:

```dotenv
MAYSEC_STORAGE_MODE=local
MAYSEC_AUTH_MODE=dev
MAYSEC_METADATA_MODE=disabled
MAYSEC_SCAN_PIPELINE_ENABLED=false
MAYSEC_RESCAN_STATE_MACHINE_ARN=
MAYSEC_DEMO_LOGIN_ENABLED=false
COGNITO_USER_POOL_ID=
COGNITO_APP_CLIENT_ID=
```

Từ `backend/`, chạy API:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --env-file .env
```

Trong terminal khác, từ thư mục gốc:

```powershell
Set-Location frontend
pnpm.cmd install --frozen-lockfile
pnpm.cmd run dev --port 5173 --strictPort
```

Mở [giao diện](http://127.0.0.1:5173), vào không gian local và chọn **Lưu trữ thật/Kết nối API** với URL `http://127.0.0.1:8000` trong cấu hình kết nối. Kiểm tra API tại [health](http://127.0.0.1:8000/health) và [Swagger](http://127.0.0.1:8000/docs).

Local không metadata ghi nội dung thật nhưng chưa có thư viện/quét trên server. Để dùng đầy đủ chức năng, cấu hình S3 + DynamoDB + Cognito và pipeline theo [hướng dẫn AWS](docs/operations/aws-deployment.md). Các chế độ khác tại [hướng dẫn phát triển local](docs/guides/local-development.md).

## Tài liệu và kiểm tra

- [Mục lục tài liệu](docs/README.md): chính sách, thiết kế, dữ liệu, API và vận hành.
- [Cấu hình](docs/reference/configuration.md), [API](docs/reference/api.md), [mô hình dữ liệu](docs/reference/data-model.md).
- [Kiểm tra và nghiệm thu](docs/operations/testing.md): build, test local và kiểm tra AWS thật.

CI kiểm tra cú pháp Python và build frontend; không deploy. Bộ test và builder Lambda chỉ giữ local theo `.gitignore`, không có sẵn trong bản clone mới. Cấu hình riêng, credentials và dữ liệu upload không thuộc mã nguồn bàn giao.

# Backend MâySec

FastAPI nhận upload, quản lý metadata/quota, phục vụ nội dung đủ điều kiện và quản lý vòng đời tệp. Owner lấy từ `sub` của access token Cognito; các API dữ liệu đều yêu cầu xác thực.

Hướng dẫn cài/chạy: [api-guide.md](../docs/api-guide.md). Endpoint và giới hạn: [api-contract.md](../docs/api-contract.md). AWS: [handoff](../docs/AWS-HANDOFF-QUICKSTART-2026-10-31.md).

Báo cáo CSV/PDF, quản lý tài khoản Cognito và quota riêng: [hướng dẫn quản trị](../docs/admin-reports-accounts.md). Cần cập nhật quyền IAM và cài lại requirements trước khi chạy bản backend mới.

## Chạy nhanh từ backend/

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Tạo `.env` từ [.env.example](.env.example) nếu chưa có. Không ghi đè file riêng đang dùng. Với Local không AWS:

```dotenv
MAYSEC_STORAGE_MODE=local
MAYSEC_AUTH_MODE=dev
MAYSEC_METADATA_MODE=disabled
MAYSEC_SCAN_PIPELINE_ENABLED=false
MAYSEC_RESCAN_STATE_MACHINE_ARN=
MAYSEC_MAX_FILE_SIZE_BYTES=100000000
```

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --env-file .env
```

Mở `/health`, `/docs` hoặc `/openapi.json`. GET / không có trang giao diện. Biến terminal/service ưu tiên hơn .env; đổi cấu hình phải restart mọi worker.

## Cấu hình AWS profile

`AWS_PROFILE=securedrive-key` là tên profile trên máy chạy backend; Boto3 dùng credentials chain, không cần sửa Settings. Khi chạy server bằng IAM role, bỏ AWS_PROFILE. AWS CLI không tự đọc .env.

S3 cần bucket/region thật và metadata DynamoDB. Pipeline chỉ bật với S3 + DynamoDB. Upload đầu chạy qua S3/EventBridge; API Quét lại mới gọi workflow STANDARD qua ARN cấu hình. MAYSEC_QUARANTINE_BUCKET_NAME phải trùng bucket của Lambda cách ly để xóa vĩnh viễn.

MaySec.cmd cũng nhận hai biến ARN quét lại/bucket cách ly; khi chọn Local/Demo hoặc tắt pipeline, ARN hiệu lực được để trống. Launcher không sửa .env gốc.

## Xác thực Cognito và thư mục từng tài khoản

S3 bắt buộc `MAYSEC_AUTH_MODE=cognito`; đặt `COGNITO_USER_POOL_ID` và `COGNITO_APP_CLIENT_ID` theo `.env.example`. Client gửi `Authorization: Bearer <access_token>` cho `/me` và mọi API tệp/quota/lịch sử/thông báo. Key upload là `uploads/<sub>/<file_id>/<tên-tệp>`; owner không nhận từ query/body/header tùy chỉnh của client.

Thiếu/sai/hết hạn token trả 401; tài khoản không có nhóm user/admin trả 403; thiếu cấu hình hoặc không tải được JWKS trả 503. Admin dùng API người dùng vẫn chỉ truy cập tệp của chính mình. `/health` công khai. `/admin/quarantine` và API đọc nội dung cách ly dành cho admin, có scope User Pool và audit bắt buộc.

Chế độ `dev` chỉ dùng với storage Local/unconfigured và trả owner `dev-user`. Frontend đã gửi token; bộ chọn tài khoản demo vào ngay chỉ bật qua `MAYSEC_DEMO_LOGIN_ENABLED=true`, xem [hướng dẫn demo](../docs/cognito-demo.md). Policy IAM cũ giới hạn `dev-user` phải được điều chỉnh cho owner thật. Thêm quyền đọc Cognito, UpdateItem bảng users, Query audit và đọc/decrypt quarantine theo policy mẫu mới. Dữ liệu cũ không tự chuyển owner.

## Kiểm thử hiện hành

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q
```

Test dùng thư mục tạm, client giả và Moto. Không gọi script kiểm thử cũ; nghiệm thu AWS thật thực hiện riêng theo handoff.

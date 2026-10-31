# Cài đặt và chạy MâySec

Hướng dẫn hiện hành ngày 31/10/2026. Hợp đồng HTTP: [api-contract.md](api-contract.md). Cài AWS: [handoff](AWS-HANDOFF-QUICKSTART-2026-10-31.md).

## 1. Chọn chế độ

| Chế độ | Cấu hình backend | Kết quả |
| --- | --- | --- |
| Demo frontend | Không cần API | Mô phỏng, không gửi nội dung |
| Local | storage=local, metadata=disabled, pipeline=false | Ghi byte thật; lịch sử trình duyệt, chưa có quét/thư viện server |
| Local + DB | storage=local, metadata=dynamodb, pipeline=false | Nội dung local, metadata/quota/lifecycle trong DB |
| S3 + DB | storage=s3, metadata=dynamodb | Upload S3, danh sách và quota server; bật pipeline sau khi AWS sẵn sàng |

Giữ MAYSEC_RESCAN_STATE_MACHINE_ARN trống khi pipeline tắt. Local/DB vẫn cần credentials DynamoDB; Local không DB không cần AWS.

## 2. Cài backend

Cần Python 3.10 trở lên. Từ thư mục backend/:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
```

Sửa .env theo chế độ; các biến chính:

| Biến | Giá trị/ý nghĩa |
| --- | --- |
| MAYSEC_STORAGE_MODE | unconfigured, local hoặc s3 |
| MAYSEC_METADATA_MODE | disabled hoặc dynamodb |
| MAYSEC_SCAN_PIPELINE_ENABLED | true chỉ khi S3 + DB + pipeline AWS sẵn sàng |
| MAYSEC_MAX_FILE_SIZE_BYTES | Mặc định/trần 100000000 byte |
| MAYSEC_LOCAL_STORAGE_DIR | data, tương đối từ backend/ |
| MAYSEC_CORS_ORIGINS | Origin web được phép; mặc định localhost/127.0.0.1:5173 |
| AWS_PROFILE | Tên profile local; bỏ khi dùng IAM role |
| S3_BUCKET_NAME / AWS_REGION | Bucket nguồn và region thật |
| MAYSEC_QUARANTINE_BUCKET_NAME | Bucket cách ly được phép xóa |
| DYNAMODB_REGION | ap-southeast-2 |
| DYNAMODB_FILES_TABLE | securedrive-files |
| DYNAMODB_AUDIT_TABLE | securedrive-audit-log |
| DYNAMODB_USERS_TABLE | securedrive-users; chưa ghép auth |
| MAYSEC_RESCAN_STATE_MACHINE_ARN | ARN STANDARD không alias/version ở Sydney; trống để tắt |

Các thông số multipart SDK dùng đơn vị kỹ thuật MiB như .env.example; nhãn dung lượng sản phẩm dùng KB/MB/GB thập phân.

Chạy API:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --env-file .env
```

Biến terminal/service ưu tiên .env. Đổi config phải restart mọi worker. GET /health xác nhận cấu hình/client, không chứng minh quyền IAM hoặc ghi AWS thành công.

## 3. Cài frontend

Cần Node.js tương thích Vite và pnpm. Từ frontend/:

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd run dev --port 5173 --strictPort
```

Trong frontend/.env.local:

```dotenv
VITE_UPLOAD_MODE=api
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_MAX_FILE_SIZE_MB=100
```

Có thể chọn kết nối trong Cài đặt của web; tùy chọn đã lưu trong trình duyệt được giữ sau reload. Không đưa AWS key vào VITE_*. Web HTTPS cần backend HTTPS; CORS phải khớp origin.

## 4. Chạy bằng launcher

Mở MaySec.cmd ở thư mục gốc. Chọn chế độ → kiểm tra cấu hình → chạy. Launcher quản lý frontend/backend, đồng bộ port/CORS/giới hạn, giữ ARN rescan và bucket cách ly. ARN hiệu lực tắt khi không dùng pipeline. Xem [launcher](../launcher/README.md).

## 5. Kiểm tra chức năng

- Chọn/kéo thả tệp nhỏ: UI báo thành công sau xác nhận API, local/S3 đúng nơi lưu.
- Reload: có thư viện API và lịch sử đã lưu; tệp tải dở cần chọn lại, không tự gửi lại.
- Tệp safe và active: thử xem/tải; ảnh 10 MB, PDF 20 MB, văn bản UTF-8 1 MB cho preview; download tối đa 100 MB.
- Quét lại: POST riêng, chặn đọc nội dung trong lúc quét; Cập nhật trạng thái chỉ đọc.
- Đổi tên không đổi key/MIME. Chuyển rác giữ quota; xóa hoàn tất mới giảm quota. Tệp đã cleanup xóa được đối soát qua lịch sử purged.
- Thử giới hạn/quota với dữ liệu test được phép; không sửa/xóa kho dùng chung để ép lỗi.

## 6. Kiểm thử và xử lý lỗi

Backend: cài requirements-dev.txt rồi chạy .venv/Scripts/python.exe -m pytest -q. Frontend: npm.cmd test, npm.cmd run build; npm.cmd run test:ui -- --project=chrome. Dùng các bộ hiện có, không cần script/test cũ.

| Hiện tượng | Kiểm tra |
| --- | --- |
| Upload 503 | Storage, metadata, profile/role; S3 bắt buộc quota DB |
| Upload 413 | 100 MB/tệp hoặc quota 1 GB không còn đủ, kể cả phần giữ chỗ |
| Quét lại bị tắt | Pipeline, ARN STANDARD, quyền DescribeStateMachine/StartExecution, restart |
| Xóa chưa hoàn tất | Bucket cách ly, ListBucketVersions và quyền xóa version ở hai bucket |
| Cấu hình khác .env | Biến terminal/service hoặc override trong launcher |
| Upload unknown | Kiểm ID và bản ghi/S3; không tự gửi lại hoặc tự xóa reservation |

Những lượt upload/notification chưa rõ kết quả cần đối soát vận hành; hiện chưa có API quản trị tự giải phóng quota hoặc gửi lại notification unknown. Giữ dữ liệu để xác minh thay vì coi là thất bại chắc chắn.

Bản này dùng dev-user, chưa xác thực nhiều tài khoản. Source chưa tự triển khai/cấp quyền AWS; nghiệm thu cloud theo handoff.

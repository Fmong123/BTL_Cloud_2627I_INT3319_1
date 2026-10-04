# Hợp đồng API — MaySec

API chạy local tại `http://127.0.0.1:8000`. OpenAPI tương tác: `/docs`; schema: `/openapi.json`. Không có xác thực ở mốc này; `dev-user` trong key chỉ là tên thử nghiệm.

## GET /health

Kiểm tra ứng dụng chạy và đọc cấu hình lưu trữ hiện tại. HTTP 200 không chứng minh dịch vụ S3 hoạt động hoặc đã upload thành công. Ví dụ mặc định:

```json
{
  "status": "ok",
  "storage": "unconfigured",
  "storage_configured": false,
  "max_file_size_bytes": 104857600,
  "scan_status": "not_started"
}
```

## POST /upload

- Body: `multipart/form-data`, trường `file`, một tệp/request.
- Frontend gửi nhiều tệp bằng hàng đợi tuần tự.
- Không tự đặt `Content-Type` ở trình duyệt; `FormData` tự tạo multipart boundary.
- Giới hạn mặc định: **104857600 byte = 100 MiB**; frontend đang hiển thị là 100 MB nhưng tính theo `1024 × 1024`.
- Server kiểm tra kích thước thực tế; validation trên frontend chỉ giúp báo lỗi sớm.
- Tổng body request bị giới hạn bằng giới hạn file cộng 1 MiB cho multipart. Middleware kiểm tra cả request không có `Content-Length`; route tiếp tục kiểm tra chính xác dung lượng file.
- HTTP **201** chỉ trả sau khi storage hoàn tất ghi dữ liệu. Không trả thành công mô phỏng trong API chạy bình thường.

Ví dụ response của chế độ local:

```json
{
  "id": "a-uuid-generated-by-server",
  "key": "uploads/dev-user/a-uuid-generated-by-server/demo.txt",
  "storage": "local",
  "original_name": "demo.txt",
  "size_bytes": 21,
  "content_type": "text/plain",
  "scan_status": "not_started"
}
```

`size_bytes` là số byte server thực sự đọc. `content_type` do client cung cấp hoặc giá trị mặc định; chưa kiểm tra định dạng bằng nội dung và chưa quét PII/malware. `scan_status=not_started` có nghĩa chưa quét.

`key` là định danh lưu trữ tương đối, không phải URL download. UUID riêng cho mỗi request ngăn hai tệp trùng tên ghi đè nhau. Không có idempotency: gửi lại cùng một tệp sẽ tạo object mới.

`storage=local` xác nhận lưu trên đĩa máy chạy API. Giá trị `s3` dành cho adapter thật sau này; repository chưa có adapter đó. Frontend cũng hiểu response cũ chỉ có `id`/`key`, nhưng không coi việc thiếu `storage` là bằng chứng S3.

### Lỗi

```json
{"detail": "Lý do thất bại"}
```

| HTTP | Khi nào |
|---|---|
| 400 | Tệp rỗng, thiếu tên hợp lệ hoặc lỗi parser multipart |
| 413 | Nội dung tệp hoặc tổng body multipart vượt giới hạn cấu hình |
| 422 | Thiếu trường `file`, sai loại trường hoặc request không khớp schema |
| 503 | Chưa cấu hình storage hoặc dịch vụ chưa sẵn sàng |
| 502 | Adapter lưu trữ gặp lỗi |

API không đưa credentials hoặc chi tiết exception nội bộ vào response. Frontend hiển thị lỗi và giữ trạng thái thất bại; không tự chuyển sang mô phỏng.

Các lỗi trong bảng là lỗi upload do ứng dụng xử lý. OPTIONS/preflight của CORS middleware có thể trả văn bản. GET `/` chưa có route (404); GET `/upload` không được hỗ trợ (405).

### CORS

Mặc định cho phép `http://localhost:5173` và `http://127.0.0.1:5173`, methods `GET`, `POST`, `OPTIONS` và header `Content-Type`, không bật cross-origin credentials. Nếu Vite chuyển sang port khác hoặc chạy trên host khác, cấu hình `MAYSEC_CORS_ORIGINS` tương ứng ở API và khởi động lại. Origin gồm protocol, hostname và port; `localhost` và `127.0.0.1` là hai origin khác nhau.

CORS là quy tắc cho trình duyệt, không phải xác thực hay kiểm tra quyền. API hiện chưa hỗ trợ cookie/token.

### Gọi bằng PowerShell

```powershell
Set-Location 'D:\Cloud UET\MaySec'
curl.exe -i -F 'file=@docs/demo-files/hello-maysec.txt' 'http://127.0.0.1:8000/upload'
```

## Hợp đồng API ↔ thành phần lưu trữ

Đọc implementation trong `backend/app/services/storage.py` trước khi bàn giao adapter. Điểm gọi chính:

```python
upload(file_obj, *, key: str, content_type: str) -> StoredObject
```

- `file_obj` đọc được và đã được đưa con trỏ về đầu sau validation; adapter không được giữ nó để xử lý sau khi request kết thúc.
- API tạo UUID/key; adapter sử dụng key được giao.
- Adapter trả `StoredObject` chỉ sau khi ghi xong; lỗi phải được ném ra theo kiểu mà route xử lý.
- Hàm upload là đồng bộ; API bố trí lời gọi trong worker thread để không chặn event loop.
- AWS-B có thể bọc `upload_to_s3(...)` của mình bằng interface này. Bucket/region/credentials lấy từ cấu hình phía server; không lấy từ browser.

Route/schema/frontend giữ hợp đồng HTTP khi thay adapter. Hướng dẫn bàn giao và chạy demo: [Hướng dẫn API](api-guide.md).

## Chức năng chưa triển khai

Không có `GET /files`, download, xóa object, database metadata dùng chung, login, owner checks, quét, KMS hoặc pipeline cách ly. Refresh sẽ xóa danh sách trên UI; file local đã ghi vẫn còn trên đĩa. Nút bỏ khỏi danh sách không xóa file đã lưu.

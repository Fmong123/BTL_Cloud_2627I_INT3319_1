# Mây4u — frontend lưu trữ tệp (tuần 1)

Frontend **React + Vite**, giao diện tiếng Việt, dành cho luồng:

```text
Chọn/kéo thả tệp → POST /upload → Backend upload_to_s3 → Amazon S3
```

## Chạy dự án

Cài Node.js 22 LTS hoặc mới hơn, sau đó:

```powershell
cd frontend
npm install
npm run dev
```

Hoặc dùng `pnpm install`, `pnpm dev` (đã kèm lockfile). Mở địa chỉ mà Vite hiển thị, mặc định http://127.0.0.1:5173.

```powershell
npm run build
```

## Đưa frontend lên GitHub

Giữ toàn bộ `frontend/src/`, `frontend/public/` và các file `frontend/index.html`, `frontend/package.json`, `frontend/pnpm-lock.yaml`, `frontend/pnpm-workspace.yaml`, `frontend/vite.config.js`, `frontend/.env.example`, `frontend/.gitignore`. Giữ README này để hướng dẫn chạy và kết nối backend.

`frontend/.gitignore` loại `tests/`, `test-results/`, `coverage/`, `node_modules/`, `.pnpm-store/`, `dist/`, log và cấu hình `.env` riêng khỏi Git. Các file test cục bộ không được import vào ứng dụng. Không chỉnh hoặc đưa thư viện đã cài và bản build vào kho mã nguồn; cài lại bằng `pnpm install --frozen-lockfile` và tạo bản triển khai bằng `pnpm build`.

Nếu upload bằng giao diện web GitHub, chỉ chọn các file trong danh sách trên vì `.gitignore` không tự lọc thao tác kéo thả trên web. Nếu chỉ tạo repository từ thư mục `frontend`, file `.gitignore` bên trong vẫn áp dụng.

## Kết nối backend S3

Mặc định là **chế độ trải nghiệm**: mô phỏng upload trong bộ nhớ, không gửi nội dung tệp qua mạng, không lưu nội dung hoặc danh sách vào localStorage/IndexedDB. Tải lại trang sẽ xóa danh sách.

Có hai cách nối backend:

1. Bấm **Chế độ trải nghiệm → Kết nối backend S3**, nhập địa chỉ, ví dụ `http://localhost:8000`, rồi lưu. Cấu hình này chỉ có hiệu lực trong phiên hiện tại. API sẽ được gọi khi chọn tệp; việc lưu URL không đồng nghĩa đã kiểm tra kết nối.
2. Sao chép `frontend/.env.example` thành `frontend/.env.local`, sửa như sau và khởi động lại Vite:

```dotenv
VITE_UPLOAD_MODE=api
VITE_API_BASE_URL=http://localhost:8000
VITE_MAX_FILE_SIZE_MB=100
```

Không đặt AWS access key/secret trong frontend hoặc biến `VITE_*`. Các biến Vite được đưa vào mã phía client ([Vite: biến môi trường](https://vite.dev/guide/env-and-mode)). Backend của nhóm giữ quyền truy cập S3 và thực hiện upload. Nếu chuyển sang upload trực tiếp sau này, có thể dùng [S3 presigned URL](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html).

### Hợp đồng API tuần 1

`POST {VITE_API_BASE_URL}/upload`

- `multipart/form-data`, trường **`file`** chứa một tệp; frontend gửi lần lượt khi chọn nhiều tệp.
- Không tự đặt header `Content-Type` để trình duyệt tạo đúng multipart boundary.
- Backend chỉ trả 2xx **sau khi S3 đã xác nhận ghi thành công**.
- Phản hồi JSON phải có `id` hoặc `key`. Hỗ trợ alias `file_id`, `s3_key` hoặc bọc trong `{ "file": ... }`.

```json
{
  "id": "file-123",
  "key": "uploads/unique-id/bao-cao.pdf"
}
```

Lỗi: trả HTTP 4xx/5xx, kèm `{"detail":"Lý do thất bại"}` (hoặc `message`/`error`). HTML, JSON không có thông tin xác nhận, HTTP lỗi và lỗi mạng không được đánh dấu thành công; không tự chuyển sang demo khi API lỗi.

**CORS:** cho phép origin frontend thực tế, ví dụ `http://127.0.0.1:5173` và/hoặc `http://localhost:5173`, với `POST`, `OPTIONS` và header cần thiết. Do frontend gửi qua backend, cấu hình CORS trên backend; frontend tuần 1 không gọi S3 trực tiếp. Frontend HTTPS cần backend HTTPS. Giới hạn tệp mặc định là 100 MB, cần cấu hình tương ứng trên backend/proxy và kiểm tra lại phía server.

Ví dụ kiểm tra backend độc lập:

```powershell
curl.exe -X POST http://localhost:8000/upload -F "file=@bao-cao.pdf"
```

## Đã triển khai

- Chọn nhiều tệp hoặc kéo thả; kiểm tra tệp rỗng và giới hạn dung lượng.
- Hàng đợi tuần tự, tiến độ thực qua XMLHttpRequest, chờ backend xác nhận trước khi báo hoàn tất.
- Hủy, thử lại, báo lỗi mạng/HTTP/timeout; cảnh báo rời trang khi đang upload.
- Danh sách/lưới, tìm kiếm có hỗ trợ gõ tiếng Việt không dấu, lọc loại, sắp xếp, đánh dấu.
- Thông tin tệp và key S3 trả về, tổng dung lượng các tệp hoàn tất trong phiên.
- Giao diện desktop/mobile, nhãn bàn phím, dialog có focus và hỗ trợ Escape.
- Không có file giả được trộn vào danh sách tệp thật; tệp trải nghiệm luôn có nhãn riêng.

## Phạm vi và bước tiếp theo

Đây là **frontend tuần 1**. Chưa có backend, tài khoản AWS, bucket, đăng nhập, API liệt kê/download/xóa file, quét PII, KMS hay cách ly tệp. Chưa xác minh upload đến S3 thật vì chưa được cung cấp backend và môi trường AWS.

Danh sách, bộ lọc và đánh dấu hiện nằm trong bộ nhớ phiên. Refresh không xóa tệp đã lưu trên S3; tuần 2 nối `GET /files` để tải lại danh sách. **Bỏ khỏi danh sách** chỉ bỏ bản ghi cục bộ, không gửi lệnh xóa S3. **Hủy upload** chỉ hủy request phía trình duyệt, không bảo đảm backend chưa lưu tệp. Nếu request timeout/hủy, kiểm tra trên server trước khi thử lại; backend nên dùng cơ chế idempotency/khóa riêng để tránh trùng và ghi đè.

Mỗi lượt upload ghi nhớ chế độ/backend ban đầu, để nút thử lại không chuyển một tệp demo sang upload thật hoặc gửi đến một máy chủ khác. Không đổi cấu hình khi còn tệp trong hàng đợi. Tệp “Đã tải lên” chỉ xác nhận API đã báo thành công, không đồng nghĩa đã quét hay mã hóa.

Font Poppins Bold Italic (700) cho logo và Manrope (hỗ trợ tiếng Việt, weight 600; riêng nội dung trong “Không gian của bạn” dùng weight 650 và tăng cỡ chữ 2px) được tải từ Google Fonts; có system font dự phòng khi offline. Có thể tự host font trước khi triển khai trong môi trường yêu cầu không gọi bên thứ ba.

## Cấu trúc

```text
frontend/
  src/
    App.jsx
    main.jsx
    styles.css
    api/client.js
    components/
      FileList.jsx
      FileIcon.jsx
      UploadButton.jsx
      StatusBadge.jsx
      Modal.jsx
    pages/Drive.jsx
    utils/files.js
  public/favicon.svg
  .gitignore
  .env.example
  index.html
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  vite.config.js
```

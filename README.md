# MaySec / Mây4u — kho lưu trữ cá nhân

Frontend **React + Vite**, giao diện tiếng Việt, đã nối với **FastAPI**. Khi chưa có phần AWS của đồng đội, API hỗ trợ demo lưu file thật trên đĩa với nhãn local rõ ràng.

```text
Chọn/kéo thả tệp → POST /upload → FastAPI validation → storage adapter
                                                         ├─ local: lưu đĩa thật
                                                         └─ unconfigured: lỗi 503
```

Hướng dẫn giải thích code, cấu hình, chứng minh dữ liệu lưu thật và kịch bản demo cho teammate: **[docs/api-guide.md](docs/api-guide.md)**. Hợp đồng endpoint và điểm ghép AWS: **[docs/api-contract.md](docs/api-contract.md)**.

Toàn bộ hướng dẫn backend/API hiện tại được tổng hợp trong **[api-guide.md](docs/api-guide.md)**: cài mới/chạy lại, biến môi trường và `.env`, Swagger/curl, demo web, kiểm tra file, kiến trúc, kiểm thử, xử lý lỗi và bàn giao adapter. Khi làm trong thư mục backend, bắt đầu từ **[backend/README.md](backend/README.md)**.

## Chế độ sử dụng

Chế độ trên frontend quyết định có gửi nội dung file đến API hay không. Chế độ storage trên backend quyết định nơi ghi file khi nhận request.

| Frontend | Storage backend | Hành vi |
|---|---|---|
| Trải nghiệm (`demo`) | Không cần chạy backend | Mô phỏng tiến độ, không gửi nội dung file; nhãn **Bản trải nghiệm** |
| API (`api`) | `local` | Gửi file thật đến FastAPI, ghi trên đĩa máy chạy backend; nhãn **Đã lưu local** |
| API (`api`) | `unconfigured` | API kiểm tra file; file hợp lệ trả **503**, không ghi file và không báo thành công |

Frontend mặc định là `demo` nếu chưa cấu hình khác. Backend mặc định là `unconfigured`; lệnh chạy bên dưới bật `local` để demo upload thật. Đã có adapter và factory/config S3, vẫn chờ uploader của Sang; chọn chế độ API trên web không tự bật S3. Xem điểm nối uploader trong [contract](docs/api-contract.md).

## Chạy API

Chuẩn bị Python 3.10 trở lên. Mở terminal PowerShell thứ nhất:

```powershell
Set-Location 'D:\Cloud UET\MaySec\backend'
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:MAYSEC_STORAGE_MODE = 'local'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Gọi trực tiếp Python trong `.venv`, không cần đổi execution policy để activate. Chỉ tạo môi trường/cài dependency ở lần đầu.

API docs: `http://127.0.0.1:8000/docs`. Health: `/health`; HTTP 200 chỉ xác nhận app/config, chưa chứng minh upload hoạt động. Local mode lưu byte thật trong `backend/data/`, không đưa vào Git. Mặc định `MAYSEC_STORAGE_MODE=unconfigured` vẫn khởi động nhưng upload hợp lệ trả 503. Mode `s3` yêu cầu bucket/region và uploader; chưa nối uploader thì `storage_configured=false` và upload trả 503.

### Địa chỉ và endpoint hiện có

| Địa chỉ / endpoint | Chức năng |
|---|---|
| `http://127.0.0.1:5173/` | Webapp React để chọn và upload file |
| `GET http://127.0.0.1:8000/docs` | Swagger UI để xem và thử API |
| `GET /redoc` | Tài liệu API dạng ReDoc |
| `GET /openapi.json` | Schema OpenAPI |
| `GET /health` | Trả trạng thái ứng dụng, loại storage, cấu hình dung lượng và trạng thái chưa quét |
| `POST /upload` | Nhận một file multipart và gọi storage |

Các endpoint tương đối trong bảng thuộc server API ở port 8000. API chưa có `GET /`: mở `http://127.0.0.1:8000/` sẽ nhận **404** `{"detail":"Not Found"}`. Mở `/upload` trực tiếp trên thanh địa chỉ gửi GET và nhận **405**; upload phải dùng POST qua webapp, Swagger hoặc curl.

Trong dialog kết nối của webapp, nhập **URL gốc** `http://127.0.0.1:8000`, không thêm `/docs` hay `/upload`; frontend tự nối `/upload`.

### Cấu hình backend

| Biến môi trường | Mặc định | Ý nghĩa |
|---|---|---|
| `MAYSEC_STORAGE_MODE` | `unconfigured` | Nhận `unconfigured`, `local` hoặc `s3` |
| `MAYSEC_LOCAL_STORAGE_DIR` | `data` | Thư mục lưu local; đường dẫn tương đối tính từ `backend/` |
| `MAYSEC_MAX_FILE_SIZE_BYTES` | `104857600` | Giới hạn byte nội dung một file |
| `MAYSEC_CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Origin frontend được phép, phân cách bằng dấu phẩy |
| `S3_BUCKET_NAME` | Rỗng | Bắt buộc khi chọn mode `s3` |
| `AWS_REGION` | Rỗng | Region của bucket; bắt buộc khi chọn mode `s3` |
| `MAYSEC_S3_MULTIPART_THRESHOLD_BYTES` | `16777216` | Ngưỡng multipart 16 MiB |
| `MAYSEC_S3_MULTIPART_CHUNKSIZE_BYTES` | `8388608` | Chunk 8 MiB; chấp nhận từ 5 MiB đến 5 GiB |
| `MAYSEC_S3_MAX_CONCURRENCY` | `2` | Tác vụ SDK song song cho mỗi upload; không giới hạn HTTP requests |

Thay đổi các biến rồi khởi động lại API. Backend không tự đọc `.env`; nếu dùng file cấu hình, sao chép `.env.example` thành `.env` và thêm `--env-file .env` vào lệnh Uvicorn. Biến môi trường đã đặt trong terminal được ưu tiên hơn giá trị trong file `.env`.

`/health` có các trường `status`, `storage`, `storage_configured`, `max_file_size_bytes`, `scan_status`. `storage_configured=true` trong local mode chỉ cho biết đã chọn adapter local; không kiểm tra khả năng ghi đĩa. `scan_status=not_started` cho biết chưa có pipeline quét.

## Chạy frontend

Chuẩn bị Node.js phù hợp phiên bản Vite và pnpm. Mở terminal PowerShell thứ hai:

```powershell
Set-Location 'D:\Cloud UET\MaySec\frontend'
pnpm.cmd install --frozen-lockfile
pnpm.cmd run dev --port 5173 --strictPort
```

Đã có pnpm lockfile. Nếu dùng npm, thay hai lệnh bằng `npm.cmd install --package-lock=false` và `npm.cmd run dev -- --port 5173 --strictPort`. Chọn một công cụ cài dependency cho dự án.

Mở địa chỉ Vite hiển thị, mặc định `http://127.0.0.1:5173`. Bấm nút chế độ/kết nối → **Kết nối API (local / S3)**, nhập `http://127.0.0.1:8000`, lưu rồi upload file mẫu [hello-maysec.txt](docs/demo-files/hello-maysec.txt). Tệp thành công có nhãn **Đã lưu local**. Chế độ trải nghiệm mặc định chỉ mô phỏng trong trình duyệt.

Build frontend:

```powershell
pnpm.cmd run build
```

## Kết nối API

Có hai cách:

1. Cấu hình trực tiếp trong dialog **Kết nối lưu trữ → Kết nối API (local / S3)**. Cấu hình này chỉ có hiệu lực trong phiên hiện tại. API được gọi khi chọn tệp; lưu URL không đồng nghĩa đã kiểm tra server.
2. Sao chép `frontend/.env.example` thành `frontend/.env.local`, sửa cấu hình và khởi động lại Vite:

```dotenv
VITE_UPLOAD_MODE=api
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_MAX_FILE_SIZE_MB=100
```

Không đặt AWS access key/secret trong frontend hoặc biến `VITE_*`; biến Vite nằm trong mã client ([Vite: biến môi trường](https://vite.dev/guide/env-and-mode)). Backend của nhóm giữ quyền truy cập S3 và ghi object khi adapter được bàn giao.

### Hợp đồng upload

`POST {VITE_API_BASE_URL}/upload`, `multipart/form-data`, trường **file** chứa một tệp. Frontend gửi lần lượt khi chọn nhiều tệp. Không tự đặt `Content-Type` để trình duyệt tạo multipart boundary.

API trả HTTP **201 sau khi storage ghi xong**, ví dụ ở local mode:

```json
{
  "id": "uuid",
  "key": "uploads/dev-user/uuid/bao-cao.pdf",
  "storage": "local",
  "original_name": "bao-cao.pdf",
  "size_bytes": 1024,
  "content_type": "application/pdf",
  "scan_status": "not_started"
}
```

Frontend đọc `storage` để phân biệt local/S3/chưa xác định. Vẫn hỗ trợ response cũ chứa `id` hoặc `key`, alias `file_id`/`s3_key` hoặc bọc trong `{ "file": ... }`; thiếu `storage` không phải bằng chứng S3. Adapter S3 chỉ trả thành công sau khi uploader xác nhận ghi xong; uploader vẫn chờ Sang triển khai.

`key` là đường dẫn tương đối trong storage, không phải link download. API dùng UUID và chuẩn hóa tên trong key, còn `original_name` giữ tên client gửi. `content_type` là giá trị client khai báo hoặc `application/octet-stream`; chưa xác minh định dạng theo nội dung. Mỗi request mới tạo ID/key mới, kể cả khi gửi lại cùng file.

Các lỗi upload được ứng dụng xử lý trả `{"detail":"Lý do thất bại"}`:

| HTTP | Khi nào |
|---|---|
| 400 | File rỗng, tên không hợp lệ hoặc multipart không hợp lệ |
| 413 | Nội dung file hoặc tổng request vượt giới hạn |
| 422 | Thiếu trường `file` hoặc trường không phải file upload |
| 503 | Storage chưa cấu hình hoặc chưa sẵn sàng |
| 502 | Storage không xác nhận lưu thành công hoặc adapter gặp lỗi |

HTML, JSON không xác nhận ghi, HTTP lỗi và lỗi mạng không được đánh dấu thành công; không tự chuyển sang demo khi API lỗi. Phản hồi CORS preflight do middleware xử lý có thể là văn bản thay vì JSON `detail`.

CORS mặc định cho phép `http://127.0.0.1:5173` và `http://localhost:5173`. Nếu frontend dùng port/host khác, đổi `MAYSEC_CORS_ORIGINS` trên backend và restart. Frontend HTTPS cần backend HTTPS. CORS không phải xác thực.

Giới hạn file mặc định **104857600 byte = 100 MiB**; UI đang gọi là 100 MB và dùng cùng cách tính. API đếm nội dung thật; middleware giới hạn tổng body bằng giới hạn file cộng 1 MiB cho multipart. Giới hạn frontend (`VITE_MAX_FILE_SIZE_MB`) và backend (`MAYSEC_MAX_FILE_SIZE_BYTES`) được cấu hình riêng; đổi một bên không tự cập nhật bên còn lại. Chi tiết mã lỗi và điểm ghép adapter trong [hợp đồng API](docs/api-contract.md).

Kiểm tra độc lập bằng PowerShell:

```powershell
Set-Location 'D:\Cloud UET\MaySec'
curl.exe -i -F 'file=@docs/demo-files/hello-maysec.txt' 'http://127.0.0.1:8000/upload'
```

## Đã triển khai

- Chọn nhiều tệp hoặc kéo thả; kiểm tra tệp rỗng và giới hạn dung lượng ở frontend/API.
- Hàng đợi tuần tự, tiến độ thực qua XMLHttpRequest; chờ API xác nhận trước khi báo hoàn tất.
- Hủy, thử lại, báo lỗi mạng/HTTP/timeout; cảnh báo rời trang khi đang upload.
- Danh sách/lưới, tìm kiếm tiếng Việt không dấu, lọc loại, sắp xếp, đánh dấu.
- Thông tin tệp/ID/key và nơi lưu local/S3/chưa xác định; tổng dung lượng các tệp hoàn tất trong phiên.
- Giao diện desktop/mobile, nhãn bàn phím, dialog có focus và hỗ trợ Escape.
- Tệp trải nghiệm có nhãn riêng; không trộn kết quả mô phỏng với file ghi thật.
- FastAPI `/health`, `/docs`, `/upload`; validation, giới hạn body, CORS và lỗi `detail`.
- Adapter local ghi file thật qua file tạm; adapter chưa cấu hình trả 503; interface để AWS-B ghép hàm upload.

## Phạm vi và bước tiếp theo

Hiện đã triển khai **frontend và API upload**, adapter và factory/config S3; vẫn chờ service uploader của Sang và nghiệm thu AWS thật. Chưa có đăng nhập, DB metadata, API liệt kê/download/xóa file, quét PII, KMS hay cách ly tệp. Local demo kiểm tra luồng browser → API → đĩa, chưa xác minh upload lên S3 thật. `dev-user` chỉ là danh tính thử nghiệm; file thành công chưa được quét.

Danh sách/bộ lọc/đánh dấu nằm trong bộ nhớ phiên. Refresh không xóa file local đã ghi; bước tiếp theo là nối `GET /files` để tải lại danh sách. **Bỏ khỏi danh sách** chỉ bỏ bản ghi UI, không xóa storage. **Hủy upload** chỉ hủy request phía browser, không bảo đảm backend chưa lưu file. Timeout/retry có thể tạo bản sao: API hiện chưa có idempotency.

Mỗi lượt upload ghi nhớ mode/backend ban đầu, để nút thử lại không chuyển file demo sang upload thật hoặc gửi tới máy chủ khác. Không đổi cấu hình khi còn file trong hàng đợi. Sau khi đổi config, thêm file mới để thử mode mới.

## Kiểm thử

Từ thư mục `backend`, cài dependency kiểm thử rồi chạy:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q
```

Các test API dùng storage giả hoặc thư mục tạm để kiểm tra hợp đồng/validation/lỗi; không phải test S3 thật. Kịch bản kiểm tra UI và so SHA256 nội dung ghi thật được ghi trong [hướng dẫn demo](docs/api-guide.md).

Từ `frontend`, chạy `pnpm.cmd run test:api-client` để kiểm tra parser response và `pnpm.cmd run build` để kiểm tra bản build.

## Cấu trúc và quản lý source

```text
backend/
  README.md
  app/
    main.py
    body_limit.py
    config.py
    dependencies.py
    routers/files.py
    schemas/file.py
    services/storage.py
  tests/
  requirements.txt
  requirements-dev.txt
  .env.example
frontend/
  src/
    api/client.js
    pages/Drive.jsx
    components/
    utils/files.js
  public/
  package.json
  pnpm-lock.yaml
  .env.example
docs/
  api-guide.md
  api-contract.md
  demo-files/hello-maysec.txt
```

Giữ source, các file cấu hình mẫu, lockfile, docs và tests backend khi đưa lên Git. Không commit `.venv`, `node_modules`, `dist`, dữ liệu upload, log hoặc `.env` riêng. Nếu upload bằng giao diện GitHub, `.gitignore` không tự lọc thao tác kéo thả trên web; kiểm tra file được chọn.

Font Poppins Bold Italic cho logo và Manrope cho nội dung được tải từ Google Fonts, có system font dự phòng offline. Có thể tự host font nếu môi trường triển khai yêu cầu không gọi bên thứ ba.

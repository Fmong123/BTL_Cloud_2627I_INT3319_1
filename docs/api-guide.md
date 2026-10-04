# Hướng dẫn API MaySec: kiến trúc, sử dụng và demo

Phần được tích hợp gồm FastAPI, kiểm tra file, CORS, chuẩn response/lỗi và điểm ghép storage. Khi chưa có AWS, bạn có thể chứng minh đường đi **webapp → API → file thật trên đĩa** bằng chế độ local được bật rõ ràng. Mặc định storage chưa cấu hình sẽ trả lỗi 503; không báo thành công giả.

Tài liệu này giải thích lớp API và công cụ demo local của MaySec. Luồng “upload từ webapp lên S3 thật” cần adapter S3 và tài nguyên/quyền AWS được bàn giao.

Đọc theo thứ tự: chế độ → cài đặt/config → kết nối webapp → kiểm tra nội dung → kiến trúc → kiểm thử/demo → bàn giao S3. Phần cuối có danh sách endpoint, cách dùng Swagger, xử lý lỗi thường gặp và quy tắc phối hợp Git.

Các lệnh PowerShell dùng vị trí clone hiện tại `D:\Cloud UET\MaySec`. Teammate clone ở nơi khác cần thay đường dẫn gốc bằng vị trí của mình. Không sao chép `.venv` từ máy khác; mỗi máy tự tạo môi trường và cài dependency.

## 1. Các chế độ cần phân biệt

| Chế độ | Dữ liệu đi đâu? | Có thể chứng minh gì? |
|---|---|---|
| Frontend trải nghiệm | Mô phỏng trong bộ nhớ trình duyệt, không gửi nội dung | Giao diện/hàng đợi/trạng thái |
| API, storage `unconfigured` | API nhận/kiểm tra nhưng chưa có nơi ghi | Hợp đồng HTTP, lỗi 503, UI xử lý lỗi |
| API, storage `local` | Ghi byte thật vào đĩa máy chạy API | Luồng UI → HTTP → validation → storage hoạt động |
| S3 sau bàn giao | Adapter ghi object vào bucket thật | Tích hợp Cloud, cần kiểm chứng object/nội dung riêng |

File được lưu thành công chưa có kết quả quét. `scan_status=not_started` không phải kết luận file an toàn.

## 2. Chạy backend bằng PowerShell

Chuẩn bị Python 3.10 trở lên. Dùng một terminal riêng cho API:

```powershell
Set-Location 'D:\Cloud UET\MaySec\backend'
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Các lệnh gọi trực tiếp Python trong `.venv`, nên không cần chạy `Activate.ps1` hay đổi execution policy. Chỉ cần tạo `.venv` và cài dependency một lần; những lần sau chạy lệnh Uvicorn.

Nếu không có Python Launcher `py` nhưng `python --version` báo Python 3.10 trở lên, thay lệnh tạo môi trường bằng `python -m venv .venv`. Kiểm tra đúng interpreter sau khi tạo:

```powershell
.\.venv\Scripts\python.exe --version
.\.venv\Scripts\python.exe -m pip --version
```

`requirements.txt` gồm FastAPI (HTTP/schema/dependency), Uvicorn (server ASGI) và python-multipart (đọc form upload). `requirements-dev.txt` thêm pytest và httpx để kiểm thử; chưa có boto3 vì chưa triển khai adapter AWS. Máy hiện tại đã được kiểm tra với Python 3.14; các lệnh trên tạo môi trường theo Python có trên máy teammate.

### Demo local có lưu file thật

```powershell
$env:MAYSEC_STORAGE_MODE = 'local'
Remove-Item Env:MAYSEC_LOCAL_STORAGE_DIR -ErrorAction SilentlyContinue
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Mặc định dữ liệu nằm trong `backend/data/` và bị loại khỏi Git. Muốn thư mục khác, đặt `MAYSEC_LOCAL_STORAGE_DIR` thành đường dẫn tuyệt đối trước khi khởi động. Khi đổi cấu hình, dừng API bằng Ctrl+C rồi chạy lại. Biến `$env:...` chỉ áp dụng cho terminal hiện tại và các process được khởi động từ đó.

Mở `http://127.0.0.1:8000/docs` để xem/gọi API; `/health` để xem app/config. Health thành công chưa xác nhận upload hoạt động.

### Demo lỗi khi chưa có storage

Trong cùng terminal, dừng Uvicorn rồi chạy:

```powershell
$env:MAYSEC_STORAGE_MODE = 'unconfigured'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Upload một tệp hợp lệ phải trả 503. File rỗng/sai request vẫn có thể bị validation từ chối trước đó.

Có thể sao chép `backend/.env.example` thành `.env` và dùng `--env-file .env` thay vì đặt biến trong terminal. Biến môi trường đang tồn tại ưu tiên hơn file `.env`; đừng giữ `MAYSEC_STORAGE_MODE` khác với chế độ bạn muốn chạy.

Ví dụ dùng file cấu hình, từ `backend/`:

```powershell
# Chỉ sao chép lần đầu nếu chưa có .env; giữ cấu hình đã có của bạn.
if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
```

Sửa `MAYSEC_STORAGE_MODE=local` trong `.env`. Nếu đã đặt cùng biến trong terminal, xóa giá trị đó rồi chạy:

```powershell
Remove-Item Env:MAYSEC_STORAGE_MODE -ErrorAction SilentlyContinue
.\.venv\Scripts\python.exe -m uvicorn app.main:app --env-file .env --host 127.0.0.1 --port 8000
```

Backend không tự đọc `.env` khi thiếu `--env-file`. Các biến server khác đã đặt trong terminal cũng được ưu tiên hơn file. Không cần AWS credentials để chạy local hoặc unconfigured.

| Biến server | Mặc định | Ý nghĩa |
|---|---|---|
| `MAYSEC_STORAGE_MODE` | `unconfigured` | Chỉ nhận `unconfigured` hoặc `local`; chưa có lựa chọn S3 |
| `MAYSEC_MAX_FILE_SIZE_BYTES` | `104857600` | Giới hạn nội dung một file tính theo byte |
| `MAYSEC_LOCAL_STORAGE_DIR` | `data` | Đường dẫn tương đối được tính từ thư mục `backend`, hoặc dùng đường dẫn tuyệt đối |
| `MAYSEC_CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Danh sách origin, phân cách bằng dấu phẩy |

Ví dụ tùy chỉnh bằng biến môi trường trước khi chạy server:

```powershell
$env:MAYSEC_STORAGE_MODE = 'local'
$env:MAYSEC_LOCAL_STORAGE_DIR = 'data'
$env:MAYSEC_MAX_FILE_SIZE_BYTES = '10485760' # 10 MiB
$env:MAYSEC_CORS_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Giới hạn frontend và backend độc lập. Ví dụ trên đặt server 10 MiB; nếu UI cũng cần báo giới hạn 10 MiB, đặt `VITE_MAX_FILE_SIZE_MB=10` trong frontend và khởi động lại Vite. Giá trị dung lượng server phải là số nguyên dương; storage mode khác `local`/`unconfigured` làm cấu hình không hợp lệ và app không khởi động. Đặt `s3` lúc này không tự tạo adapter.

### Dừng, khởi động lại và phát triển

- Ctrl+C ở terminal Uvicorn để dừng API; Ctrl+C ở terminal Vite để dừng frontend. Dừng process không xóa file đã lưu local.
- Sau khi sửa biến môi trường/config hoặc đổi adapter, dừng và chạy lại API để nạp cấu hình mới.
- Khi sửa Python thường xuyên, có thể thêm `--reload` vào lệnh Uvicorn cho môi trường phát triển. Reload theo dõi source; không thay thế việc đặt lại biến môi trường rồi restart.
- Server hướng dẫn ở đây chỉ bind `127.0.0.1`. `localhost` trên máy teammate là máy của teammate, không phải máy của bạn. Hướng dẫn này dành cho chạy/demo trên từng máy; chưa có triển khai dùng chung hay xác thực.

## 3. Chạy webapp và gọi API thật

Chuẩn bị Node.js phù hợp với phiên bản Vite của repo và pnpm. Mở terminal thứ hai:

```powershell
Set-Location 'D:\Cloud UET\MaySec\frontend'
pnpm.cmd install --frozen-lockfile
pnpm.cmd run dev --port 5173 --strictPort
```

Lệnh `.cmd` tránh vấn đề execution policy của PowerShell. Repo có sẵn pnpm lockfile. Nếu dùng npm, thay bằng `npm.cmd install --package-lock=false`, `npm.cmd run dev -- --port 5173 --strictPort`. Chọn một công cụ cài dependency cho dự án.

1. Mở địa chỉ Vite hiển thị, thường là `http://127.0.0.1:5173`.
2. Bấm nút chế độ/kết nối, chọn **Kết nối API (local / S3)**, nhập `http://127.0.0.1:8000`, lưu.
3. Chọn/kéo thả file mẫu `D:\Cloud UET\MaySec\docs\demo-files\hello-maysec.txt`. Chờ server trả 201; nhãn thành công ghi **Đã lưu local**.
4. Mở thông tin tệp để xem nơi lưu, ID/key và trạng thái chưa quét; mở Developer Tools → Network → request `/upload` để xem response JSON.

Lưu URL trên UI chỉ cập nhật cấu hình phiên, không kiểm tra server ngay. Mỗi tệp giữ cấu hình tại lúc được đưa vào hàng đợi; thử lại tệp đó vẫn dùng URL/chế độ cũ. Sau khi đổi cấu hình, thêm tệp mới để demo chế độ mới.

Muốn API là chế độ mặc định của frontend:

```powershell
Copy-Item -LiteralPath '.env.example' -Destination '.env.local'
```

Sửa `.env.local`, rồi khởi động lại Vite:

```dotenv
VITE_UPLOAD_MODE=api
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_MAX_FILE_SIZE_MB=100
```

Biến `VITE_*` nằm trong mã trình duyệt; chỉ đặt URL/chế độ/giới hạn, không đặt AWS credentials.

## 4. Chứng minh file lưu thật, thay vì chỉ xem nhãn UI

Repo có file mẫu [hello-maysec.txt](demo-files/hello-maysec.txt), không chứa dữ liệu cá nhân. Upload file đó qua webapp khi API chạy `local`. Copy giá trị `key` từ response hoặc thông tin tệp, rồi chạy:

```powershell
Set-Location 'D:\Cloud UET\MaySec'
$uploadedKey = 'uploads/dev-user/THAY-UUID-TU-RESPONSE/hello-maysec.txt'
$storedFile = Join-Path '.\backend\data' $uploadedKey
Get-Content -LiteralPath $storedFile
Get-FileHash -LiteralPath '.\docs\demo-files\hello-maysec.txt' -Algorithm SHA256
Get-FileHash -LiteralPath $storedFile -Algorithm SHA256
```

Hai SHA256 phải trùng nhau. Nếu đổi thư mục storage, thay `backend/data` bằng thư mục thực tế. Sau refresh webapp, danh sách trống vì chưa có `GET /files`, nhưng `Get-Content` vẫn đọc được file đã lưu; restart API cũng không tự xóa dữ liệu local.

Upload hai lần file cùng tên: response phải có ID/key khác nhau và hai file được giữ riêng. Đây là chống ghi đè tên, chưa phải chống tạo bản sao khi retry.

## 5. Code chạy theo thứ tự nào?

```text
Drive.jsx: chọn file, kiểm tra sớm, đưa vào hàng đợi
  → client.js: XMLHttpRequest + FormData(file)
  → FastAPI: CORS/multipart và dependency storage
  → route /upload: đọc theo chunk, kiểm tra byte, tạo UUID/key
  → storage.upload: ghi dữ liệu thật hoặc báo chưa cấu hình
  → JSON HTTP 201 hoặc detail + HTTP lỗi
  → client.js kiểm tra response
  → Drive.jsx lưu ID/key/storage và hiển thị trạng thái
```

### Frontend

- `frontend/src/pages/Drive.jsx` quản lý danh sách trong bộ nhớ, cấu hình kết nối và hàng đợi. Mỗi request xử lý một tệp; tệp tiếp theo chỉ bắt đầu sau khi tệp hiện tại kết thúc. Không tự chuyển từ lỗi API sang chế độ trải nghiệm.
- `frontend/src/api/client.js` tạo `FormData`, gắn trường `file`, gửi đến `/upload`. Tiến độ tải byte qua XMLHttpRequest giữ tối đa 99%; chỉ chuyển thành công khi HTTP/JSON hợp lệ. Nó đọc `storage` để UI phân biệt local/S3/phản hồi cũ chưa xác định.
- `frontend/src/components/StatusBadge.jsx` và phần thông tin tệp hiển thị nhãn phù hợp với chế độ/nơi lưu.
- `frontend/src/utils/files.js` kiểm tra rỗng và dung lượng trước khi gửi; API vẫn tự kiểm tra vì client có thể bị bỏ qua.

### Backend

- `backend/app/main.py` tạo ứng dụng, gắn CORS, health và router. Cấu hình/dependency được tập trung để route không cần biết cách dựng storage.
- `backend/app/body_limit.py` chặn tổng body của `POST /upload` vượt giới hạn file cộng 1 MiB dành cho multipart. Nó kiểm tra `Content-Length` và đếm byte thực nhận cả khi client không gửi header đó; lỗi trả 413 vẫn có CORS để UI đọc được.
- `backend/app/config.py` đọc biến môi trường và kiểm tra cấu hình. Không chứa credentials hardcode.
- `backend/app/dependencies.py` cung cấp thành phần storage theo cấu hình. Đây là điểm ghép adapter của đồng đội.
- Cụ thể, `create_app()` trong `main.py` chọn/tạo adapter và đặt vào `app.state.storage`; `get_storage()` trong `dependencies.py` chỉ lấy lại adapter đó cho route. Tương tự, settings được đọc qua `app.state.settings`. Test có thể truyền adapter vào `create_app()` hoặc override dependency.
- `backend/app/routers/files.py` xử lý request HTTP: validation, UUID/key, gọi storage, định dạng thành công/lỗi. Đọc file theo chunk để không nạp toàn bộ file vào RAM; đưa con trỏ về đầu trước khi adapter đọc và đóng file sau request.
- `backend/app/schemas/file.py` định nghĩa response bằng Pydantic và công bố nó vào OpenAPI; giúp FE/AWS-B dùng cùng tên trường.
- `backend/app/services/storage.py` định nghĩa interface, kết quả và lỗi lưu trữ. Adapter local ghi byte thật; adapter chưa cấu hình báo 503. Tên/key được kiểm soát để filename từ client không chọn đường dẫn tùy ý.
- `backend/tests/` kiểm tra hợp đồng/validation/adapter và CORS. Storage giả trong test là công cụ kiểm tra riêng, không phải chế độ thành công giả của webapp.

FastAPI parse multipart vào file tạm trước khi route kiểm tra kích thước file. Middleware giới hạn tổng request, còn route kiểm tra đúng số byte nội dung file. Nếu triển khai sau này, nhóm cần cấu hình giới hạn request, timeout, dung lượng tạm và số kết nối ở hạ tầng tương ứng. MIME type là thông tin client khai báo, chưa phải kiểm tra bảo mật nội dung.

Adapter local ghi vào file `.part`, flush/fsync rồi đổi sang tên cuối sau khi hoàn tất; dọn file đang ghi khi gặp lỗi. Response 201 chỉ xuất hiện sau bước này. Nó giữ nội dung file, chưa ghi metadata thành database hoặc cung cấp API đọc lại.

Route đồng bộ được FastAPI chạy trong threadpool. Luồng chi tiết là: parse multipart → đọc file từng chunk 1 MiB/đếm byte → từ chối file rỗng/quá giới hạn → seek về đầu → tạo UUID/key → gọi adapter → kiểm tra adapter giữ đúng key và trả storage hợp lệ → tạo response → đóng file trong `finally`.

Key dùng dạng `uploads/dev-user/<uuid>/<safe-name>`. Hàm `safe_filename()` xử lý cả dấu phân cách Windows/Linux, chuẩn hóa tên, thay ký tự không phù hợp và tránh tên thiết bị Windows như `CON`, `AUX`, `LPT1`. `original_name` vẫn giữ tên client gửi; tên hiển thị và tên lưu có thể khác nhau. Adapter local kiểm tra đường dẫn nằm trong storage root.

Việc dọn file `.part` được thực hiện khi có lỗi; nếu hệ điều hành từ chối dọn thì code giữ lỗi ban đầu, file tạm có thể còn lại để kiểm tra thủ công. Chỉ dọn file thử nghiệm đã xác định, không xóa cả thư mục dữ liệu dùng chung.

## 6. Kịch bản trình bày trong 5–7 phút

| Bước | Thao tác | Nội dung giải thích |
|---|---|---|
| 1 | Mở `/docs` và `/health` | API có endpoint/schema; health chỉ kiểm tra app/config |
| 2 | Chọn Kết nối API trên webapp | FE gửi multipart field `file` qua HTTP |
| 3 | Upload file local, xem response | UUID/key riêng; 201 sau khi ghi; chưa quét |
| 4 | Đọc file trên đĩa, so SHA256 | Nội dung thật đi từ browser qua API tới storage |
| 5 | Upload hai file cùng tên | Key khác nhau, không ghi đè |
| 6 | Restart ở `unconfigured`, upload tệp mới | Lỗi 503 xuất hiện trên UI, không thành công giả |
| 7 | Chỉ vào interface storage | AWS-B thay adapter; FE/route giữ nguyên hợp đồng |

Bạn có thể nói: “Em đã hoàn thành lớp HTTP cho chức năng upload và ghép vào frontend. Local mode để test tích hợp khi chưa có S3. Luồng S3 thật đang chờ adapter/hạ tầng; validation, CORS và response đã có thể kiểm thử độc lập.”

### Kiểm tra lỗi độc lập với frontend

```powershell
# Thiếu field file: 422.
curl.exe -i -X POST 'http://127.0.0.1:8000/upload'

# File rỗng: 400; frontend có thể chặn trước khi gửi nên dùng curl để test API.
Set-Location 'D:\Cloud UET\MaySec\backend'
New-Item -ItemType Directory -Path '.\data\demo-input' -Force | Out-Null
[System.IO.File]::WriteAllBytes('D:\Cloud UET\MaySec\backend\data\demo-input\empty.txt', [byte[]]@())
curl.exe -i -F 'file=@data/demo-input/empty.txt' 'http://127.0.0.1:8000/upload'

# Preflight từ origin được phép.
curl.exe -i -X OPTIONS 'http://127.0.0.1:8000/upload' -H 'Origin: http://127.0.0.1:5173' -H 'Access-Control-Request-Method: POST'
```

Để demo 413, hạ `MAYSEC_MAX_FILE_SIZE_BYTES` của API xuống 1024 và restart, rồi gửi file > 1024 byte bằng curl. Frontend có giới hạn riêng; hạ giới hạn server giúp chứng minh server không tin client. Khôi phục cấu hình sau demo.

### Chạy kiểm thử đã có

```powershell
Set-Location 'D:\Cloud UET\MaySec\backend'
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q

Set-Location 'D:\Cloud UET\MaySec\frontend'
pnpm.cmd run test:api-client
pnpm.cmd run build
```

Test parser frontend kiểm tra response local/S3/legacy và phản hồi sai. Test backend kiểm tra hợp đồng/validation/lỗi và file tạm; không sử dụng tài khoản AWS. Demo browser và so SHA256 bổ sung bằng chứng tích hợp thật ở local.

## 7. Chuyển sang AWS khi đồng đội hoàn thành

1. AWS-A bàn giao bucket/region và phương thức cấp quyền phía server; AWS-B bàn giao hàm upload, dependencies và kiểu lỗi.
2. AWS-B/API cùng implement interface `Storage.upload(...)` và trả `StoredObject` đúng định nghĩa trong code, với `storage='s3'` sau khi S3 xác nhận.
3. Ghép adapter trong factory `create_app()` của `main.py`, bổ sung cấu hình/chế độ cần thiết trong `config.py`; dependency tiếp tục lấy adapter từ `app.state.storage`. Chưa có adapter S3 thì không bật chế độ đó hoặc báo kết quả Cloud giả.
4. Kiểm tra API bằng curl, đối chiếu key và đọc lại object thật; sau đó kiểm tra từ webapp. Giữ `/upload` và trường response đang được FE dùng.
5. Tiếp tục metadata dùng chung/`GET /files`, xác thực/quyền và pipeline quét theo kế hoạch các tuần sau.

API chịu trách nhiệm HTTP/validation/response/CORS. AWS-B chịu trách nhiệm ghi object và xử lý SDK; AWS-A chịu trách nhiệm hạ tầng/quyền. Đây là các phần trong cùng backend, không bắt buộc tạo hai server gọi HTTP cho nhau.

Adapter bàn giao phải có `mode`, `configured` và method `upload(file_obj, *, key, content_type)`. Trả `StoredObject(key=key, storage="s3")` chỉ khi S3 đã xác nhận ghi. Dịch vụ không sẵn sàng ném `StorageUnavailable` (route trả 503); ghi thất bại ném `StorageFailure` (502). Không giữ file handle để upload nền sau response: route đóng handle khi request kết thúc. `configured` là thông tin cấu hình adapter, không phải bằng chứng một upload thành công.

## 8. Giới hạn khi bàn giao

Chưa có auth, S3 thật, DB metadata, list/download/xóa object, idempotency, quét PII/malware, KMS và cách ly. Không triển khai API chưa auth ra mạng public. Nút hủy phía browser không bảo đảm server chưa ghi file; timeout/retry có thể tạo object mới. Bỏ khỏi danh sách chỉ bỏ bản ghi UI.

Local storage không thay thế S3 trong báo cáo Cloud. Các file demo đã ghi phải được dọn thủ công khi không cần; chúng bị ignore khỏi Git. Danh sách UI chưa được khôi phục sau refresh.

Hợp đồng request/response: [api-contract.md](api-contract.md). Kế hoạch tổng thể của nhóm nằm ngoài repo tại `D:\Cloud UET\BTL\Ke_Hoach_API_MaySec.md`.

## 9. Tài liệu tham khảo chính thức

- [FastAPI: nhận file với UploadFile](https://fastapi.tiangolo.com/tutorial/request-files/).
- [FastAPI: CORS và origin](https://fastapi.tiangolo.com/tutorial/cors/).
- [FastAPI: thay dependency khi kiểm thử](https://fastapi.tiangolo.com/advanced/testing-dependencies/).

## 10. Endpoint và cách dùng Swagger

Base URL API mặc định: `http://127.0.0.1:8000`. Webapp nằm ở `http://127.0.0.1:5173/`.

| Method/path | Có thể làm gì? |
|---|---|
| `GET /health` | Xem app đang phản hồi, storage/config và trạng thái chưa quét |
| `POST /upload` | Nhận một file multipart field `file`, ghi qua adapter, trả 201 khi thành công |
| `GET /docs` | Mở Swagger UI để xem schema và thử request |
| `GET /redoc` | Đọc tài liệu ReDoc |
| `GET /openapi.json` | Lấy schema OpenAPI để frontend/tooling đối chiếu |

Chưa có route `GET /`, vì vậy mở base URL trực tiếp nhận 404 `{"detail":"Not Found"}`. Mở `/upload` trên thanh địa chỉ gửi GET nên nhận 405. Hai response này không có nghĩa backend ngừng chạy. `GET /files` và API download chưa tồn tại.

Thử `/health` trong Swagger:

1. Mở `/docs`, mở mục **Health → GET /health**.
2. Bấm **Try it out**, rồi **Execute**.
3. Đọc phần **Server response** (response thực tế); phần **Example Value/Schema** là mô tả schema, không phải kết quả vừa gọi.

Response mẫu khi chưa cấu hình:

```json
{
  "status": "ok",
  "storage": "unconfigured",
  "storage_configured": false,
  "max_file_size_bytes": 104857600,
  "scan_status": "not_started"
}
```

Local mode đổi `storage` thành `local` và `storage_configured` thành `true`. Health không thử ghi file, không kiểm tra AWS và không trả danh sách file.

Thử upload trong Swagger:

1. Chạy backend ở `local`, mở **Files → POST /upload**.
2. Bấm **Try it out**, chọn file ở trường `file`, bấm **Execute**.
3. Xem HTTP 201 và JSON trong **Server response**; nếu nhận 503, kiểm tra storage mode rồi restart API.
4. Copy `key` để đối chiếu với file trên đĩa. Nút **Execute** gửi file thật khi API ở local, không chỉ hiển thị ví dụ.

Response mẫu:

```json
{
  "id": "uuid-do-server-tao",
  "key": "uploads/dev-user/uuid-do-server-tao/hello-maysec.txt",
  "storage": "local",
  "original_name": "hello-maysec.txt",
  "size_bytes": 153,
  "content_type": "text/plain",
  "scan_status": "not_started"
}
```

Số byte/UUID thực tế tùy file và request. `key` không phải URL có thể mở để tải file; `content_type` là client khai báo; `scan_status` chưa có ý nghĩa đã kiểm tra nội dung. Schema và mã lỗi đầy đủ nằm trong [api-contract.md](api-contract.md).

### Upload và xác minh nội dung tự động bằng PowerShell

Ví dụ này gửi một upload mới đến server local đang chạy; mỗi lần chạy tạo thêm bản lưu mới:

```powershell
Set-Location 'D:\Cloud UET\MaySec'
$uploadResult = curl.exe --silent --show-error -F 'file=@docs/demo-files/hello-maysec.txt' 'http://127.0.0.1:8000/upload' | ConvertFrom-Json
if ($uploadResult.storage -ne 'local' -or -not $uploadResult.key) {
    throw 'Upload local chưa được xác nhận; kiểm tra response và cấu hình API'
}
$savedPath = Join-Path '.\backend\data' $uploadResult.key
$sourceHash = (Get-FileHash -LiteralPath '.\docs\demo-files\hello-maysec.txt' -Algorithm SHA256).Hash
$savedHash = (Get-FileHash -LiteralPath $savedPath -Algorithm SHA256).Hash
$uploadResult
"Noi luu: $savedPath"
"Noi dung trung khop: $($sourceHash -eq $savedHash)"
```

Thay `backend/data` nếu đã cấu hình storage root khác. Không thêm `-i` vào lệnh curl đang pipe `ConvertFrom-Json`, vì header HTTP làm đầu ra không còn là JSON thuần.

## 11. Lỗi thường gặp và cách xử lý

| Hiện tượng | Cách kiểm tra / xử lý |
|---|---|
| Không tìm thấy `py` | Dùng `python --version`; nếu Python đúng phiên bản, tạo venv bằng `python -m venv .venv` |
| `ModuleNotFoundError` cho fastapi/uvicorn | Gọi đúng `.venv\Scripts\python.exe`, cài `-r requirements.txt` bằng chính interpreter đó |
| Báo cần python-multipart | Cài lại requirements trong venv; trường upload dùng multipart, không phải JSON |
| `Could not import module app.main` | Chạy Uvicorn từ thư mục `backend/`; kiểm tra có `app/main.py` |
| API không mở được / connection refused | Kiểm tra terminal Uvicorn còn chạy, đúng host/port; thử `/health` |
| Port 8000 đã dùng | Dừng server của mình bằng Ctrl+C hoặc chạy `--port 8001`; đổi URL kết nối web thành port mới, không dừng process lạ |
| Vite báo port 5173 đã dùng | Dừng phiên Vite cũ của mình hoặc chọn port khác; cập nhật `MAYSEC_CORS_ORIGINS` và restart API |
| Browser mở port 8000 thấy Not Found | Dùng `/docs` hoặc `/health`; giao diện upload ở port 5173 |
| HTTP 405 khi mở `/upload` | Dùng POST multipart qua UI/Swagger/curl |
| HTTP 422 | Kiểm tra field chính xác là `file`, giá trị là file, body multipart; gửi JSON/base64 không khớp hợp đồng |
| HTTP 400 | Kiểm tra file rỗng/tên/multipart; curl `-F` tự tạo boundary |
| HTTP 413 | Kiểm tra giới hạn server và tổng multipart; frontend có giới hạn riêng |
| HTTP 503 | Chọn `MAYSEC_STORAGE_MODE=local`, restart; kiểm tra `.env` có được load và biến terminal có ghi đè không |
| HTTP 502 | Kiểm tra quyền ghi/storage root, dung lượng ổ đĩa và terminal API; không coi request thất bại là đã lưu thành công |
| UI báo lỗi CORS | Kiểm tra origin đầy đủ của web (protocol/host/port), chỉnh `MAYSEC_CORS_ORIGINS`; curl thành công không chứng minh browser CORS đúng |
| UI HTTPS kết nối HTTP thất bại | Client từ chối mixed content; môi trường HTTPS cần API HTTPS phù hợp |
| UI hiện Bản trải nghiệm | Chuyển sang API và chọn lại file; bản trải nghiệm không tự chuyển thành upload thật |
| `.env` sửa mà mode chưa đổi | Uvicorn cần `--env-file .env`; biến terminal được ưu tiên; restart sau khi đổi config |
| Refresh mất danh sách | Danh sách ở bộ nhớ phiên, chưa có GET /files; kiểm tra file đã ghi trên đĩa |
| Retry tạo hai file | Chưa có idempotency; UUID mới cho mỗi request, kiểm tra server trước khi retry sau timeout |
| Có file `.part` sau lỗi | Kiểm tra quyền/dung lượng; cleanup có thể bị OS từ chối; dọn thủ công đúng file thử nghiệm nếu không còn request dùng nó |
| Swagger không hiển thị dù `/health` chạy | Swagger UI mặc định tải asset CDN; kiểm tra network browser, dùng `/openapi.json` hoặc curl để đọc/gọi API |

### Kiểm tra CORS khi đổi port frontend

Ví dụ web chạy port 5174: đặt trước khi khởi động API:

```powershell
$env:MAYSEC_CORS_ORIGINS = 'http://localhost:5174,http://127.0.0.1:5174'
```

Phản hồi OPTIONS/preflight của CORS middleware có thể là text, không phải JSON `detail`. CORS không chặn mọi client ngoài trình duyệt và không thay thế đăng nhập/owner checks.

### Tạo file để demo lỗi 413

Trong terminal API, dừng server, đặt giới hạn 1024 byte rồi chạy lại. Trong terminal khác tạo file 2048 byte và gửi:

```powershell
Set-Location 'D:\Cloud UET\MaySec\backend'
New-Item -ItemType Directory -Path '.\data\demo-input' -Force | Out-Null
[System.IO.File]::WriteAllBytes((Join-Path (Get-Location).Path 'data\demo-input\oversize.bin'), [byte[]]::new(2048))
curl.exe -i -F 'file=@data/demo-input/oversize.bin' 'http://127.0.0.1:8000/upload'
```

Kỳ vọng 413. Sau demo, đặt server `MAYSEC_MAX_FILE_SIZE_BYTES=104857600`, rồi restart để quay lại giới hạn mặc định.

## 12. Bàn giao source và phối hợp teammate

| Phần | Trách nhiệm đề xuất |
|---|---|
| `routers/files.py`, `schemas/file.py` | Người API giữ hợp đồng HTTP/validation |
| `services/storage.py` | Interface dùng chung; thống nhất trước khi sửa |
| `services/s3_storage.py` (chưa có) | Teammate bổ sung adapter S3 |
| `main.py`, `config.py`, `requirements.txt` | Phối hợp/giao một người ghép adapter và dependencies |
| `infra/`, `lambdas/` (chưa có) | Teammate bổ sung hạ tầng và pipeline |

Folder `backend/` dùng chung cho API và xử lý AWS; không cần tạo thêm backend thứ hai. Sau khi khung được commit/push, teammate cập nhật nhánh chung trước khi bắt đầu và làm trên branch riêng. Cùng tạo `main.py` hoặc cùng sửa đoạn config có thể gây conflict; tạo adapter mới và bàn giao hợp đồng trước giúp giảm xung đột.

Giữ source, tests, requirements, `.env.example` và docs. Không commit `.venv`, `.env`, dữ liệu upload, node_modules, build/cache/log. Với storage root tùy chỉnh trong repo ngoài `backend/data`, phải bổ sung gitignore tương ứng vì rule hiện tại chỉ ignore đường dẫn mặc định. Thư mục local chứa byte file; chưa có metadata bền vững, quota, API dọn/xóa hay cơ chế tự dọn dữ liệu.

Checklist demo/bàn giao hiện tại: API khởi động được → health/config đúng → POST upload 201 local → byte/SHA256 đúng → rỗng/missing/oversize lỗi đúng → unconfigured trả 503 → browser đọc được response/CORS → teammate chạy lại được theo tài liệu. Đây là bằng chứng cho API/local; kiểm chứng S3 là bước riêng sau khi adapter thật được bàn giao.

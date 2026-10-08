# Hợp đồng API — MaySec

API chạy local tại `http://127.0.0.1:8000`. OpenAPI tương tác: `/docs`; schema: `/openapi.json`. OpenAPI sinh từ routes và Pydantic schemas là nguồn chuẩn của hợp đồng HTTP; tài liệu này giải thích hành vi và bàn giao nội bộ. Không có xác thực ở mốc này; `dev-user` trong key chỉ là tên thử nghiệm.

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

`storage=local` xác nhận lưu trên đĩa máy chạy API. Repository có `S3Storage` và factory/config hỗ trợ S3, nhưng service AWS chưa triển khai uploader A theo contract bên dưới. Giá trị `s3` trong response upload chỉ được trả khi adapter gọi uploader và nhận xác nhận thành công. Frontend cũng hiểu response cũ chỉ có `id`/`key`, nhưng không coi việc thiếu `storage` là bằng chứng S3.

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
- `S3Storage` bọc `upload_to_s3(...)` bằng interface này. Bucket/region/credentials lấy từ cấu hình phía server; không lấy từ browser.

Route/schema/frontend giữ hợp đồng HTTP khi thay adapter. Hướng dẫn bàn giao và chạy demo: [Hướng dẫn API](api-guide.md).

### Bàn giao S3Storage ↔ service của Sang — phương án A

**Trạng thái: contract đề xuất để Sang xác nhận trước khi triển khai service.** Bạn sở hữu adapter/API, Sang sở hữu service/client/transfer settings. Typed interface `S3Uploader` trong `backend/app/services/s3_storage.py` là điểm bàn giao của code Python. Không đổi chữ ký hoặc kiểu trả về riêng lẻ giữa hai bên.

Luồng: `POST /upload → Storage.upload → S3Storage → upload_to_s3 → S3`.

Chữ ký service cần triển khai:

```python
def upload_to_s3(
    file_obj,
    *,
    key: str,
    content_type: str,
    client,
    bucket: str,
    transfer_config,
) -> str:
    # Ghi S3 đồng bộ; chỉ sau khi SDK thành công mới trả key.
    ...
```

| Đầu vào | Yêu cầu |
|---|---|
| `file_obj` | Binary file-like đã validation và rewind về đầu; không đọc toàn bộ thành bytes chỉ để upload |
| `key` | API sinh dạng `uploads/dev-user/UUID/safe-name`; service giữ nguyên, không tự sinh UUID khác |
| `content_type` | API truyền từ request hoặc `application/octet-stream`; service truyền vào `ExtraArgs.ContentType`; đây chưa phải xác minh định dạng nội dung |
| `client` | S3 client tạo từ config/factory phía server, có thể thay bằng stub trong tests |
| `bucket` | Bucket phía server; không lấy từ browser |
| `transfer_config` | Boto3 TransferConfig đã tạo ngoài adapter; service chuyển vào tham số `Config` của upload_fileobj |

**Quy tắc trả kết quả:** service gọi `client.upload_fileobj(...)`, chờ thao tác hoàn tất rồi `return key`. SDK upload_fileobj có thể trả `None` khi thành công; wrapper của Sang phải chuyển thành chuỗi key. Không nuốt exception rồi trả `None`. Adapter từ chối `None`, boolean hoặc key khác. Chuỗi key chỉ là xác nhận theo contract, không tự chứng minh bytes trên S3 nếu uploader viết sai; nghiệm thu vẫn phải đối chiếu hash trên AWS thật.

Service không tạo presigned URL để thay cho ghi file, không giữ handle sau request và không chịu trách nhiệm validation/UUID/schema HTTP. Cleanup handle cuối request do route thực hiện. Bucket/credentials không được đưa vào response upload.

| Trường hợp | Adapter | HTTP qua route hiện có |
|---|---|---|
| Thiếu bucket/client/transfer config/uploader | StorageUnavailable; không gọi service | 503 |
| Thiếu credentials, thiếu một phần credentials hoặc region khi service gọi SDK | StorageUnavailable | 503 |
| ClientError, lỗi SDK khác hoặc I/O | StorageFailure | 502 |
| Service tự ném StorageUnavailable/StorageFailure | Giữ nguyên loại lỗi | 503/502 |
| Service trả kết quả không đúng contract | StorageFailure | 502 |
| Lỗi ngoài các loại trên | Route bắt lỗi bất ngờ, không lộ chi tiết | 502 |

`configured=True` chỉ nói dependencies đã được cung cấp; không chứng minh IAM/bucket/mạng hoạt động. Adapter không tự retry POST, không tạo client hoặc import s3_service ở module scope. Retry SDK thuộc service của Sang. Lỗi sau khi S3 có thể đã ghi không tự retry bằng UUID mới.

`config.py` đã hỗ trợ mode `s3`; khi chọn mode này, bucket và region phải được cung cấp, nếu thiếu ứng dụng báo lỗi cấu hình lúc khởi động. `main.py` đã có factory tạo S3 client/TransferConfig và adapter khi nhận uploader. Cấu hình mẫu nằm trong `backend/.env.example`; Settings không tự đọc `.env`, dùng Uvicorn `--env-file .env` nếu cần.

Khi service sẵn sàng và đã bỏ việc tạo client lúc import, nối uploader vào application factory:

```python
# Chỉ thêm import này sau khi Sang hoàn thành/refactor service.
from .services.s3_service import upload_to_s3

app = create_app(s3_uploader=upload_to_s3)
```

Điểm khởi động hiện tại vẫn là `app = create_app()` vì service chưa có `upload_to_s3`. Trong mode S3 khi chưa truyền uploader, `/health` trả `storage=s3`, `storage_configured=false` và file hợp lệ trả 503; factory không tạo AWS client. Không import service hiện tại chỉ để tìm hàm vì có side effect khởi tạo client.

Factory dùng credentials chain mặc định của Boto3, không nhận AWS keys từ frontend. Client tạo một lần cho ứng dụng và đóng khi ứng dụng shutdown; storage được inject trực tiếp vẫn do caller quản lý. Nếu SDK không tạo được client, app giữ S3 chưa sẵn sàng và upload trả 503; sửa cấu hình rồi khởi động lại.

TransferConfig dùng ngưỡng multipart 16 MiB, chunk 8 MiB, tối đa 2 tác vụ truyền cho mỗi upload và classic transfer manager. Đây là giá trị khởi đầu để đo, không phải giới hạn request đồng thời hoặc cơ chế resume từ browser. Các biến `MAYSEC_S3_MULTIPART_THRESHOLD_BYTES`, `MAYSEC_S3_MULTIPART_CHUNKSIZE_BYTES`, `MAYSEC_S3_MAX_CONCURRENCY` cho phép điều chỉnh; chunk phải từ 5 MiB đến 5 GiB.

Kiểm thử bàn giao: adapter dùng uploader stub; service dùng client stub; HTTP test inject adapter qua create_app và kiểm response/error/đóng handle. Tests không cần credentials và không gọi AWS. Demo AWS thật phải kiểm key và SHA256; `scan_status` vẫn `not_started` đến khi nối pipeline/status.

## Chức năng chưa triển khai

Không có `GET /files`, download, xóa object, database metadata dùng chung, login, owner checks, quét, KMS hoặc pipeline cách ly. Refresh sẽ xóa danh sách trên UI; file local đã ghi vẫn còn trên đĩa. Nút bỏ khỏi danh sách không xóa file đã lưu.

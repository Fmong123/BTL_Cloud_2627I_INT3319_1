# Hợp đồng API — MaySec

API chạy local tại `http://127.0.0.1:8000`. OpenAPI tương tác: `/docs`; schema: `/openapi.json`. OpenAPI sinh từ routes và Pydantic schemas là nguồn chuẩn của hợp đồng HTTP; tài liệu này giải thích hành vi và bàn giao nội bộ. Không có xác thực ở mốc này; `dev-user` trong key chỉ là tên thử nghiệm.

## GET /health

**Cập nhật bàn giao AWS 23/10/2026:** đã có upload metadata/audit, GET /files và GET /files/{id}/status, tám trạng thái và summary của Scan. Cách test local/DB thật/S3 pipeline: [hướng dẫn API local](dynamodb-fastapi-local-test-guide.md). Owner hiện là dev-user cố định, chưa có xác thực.

Kiểm tra ứng dụng chạy và đọc cấu hình lưu trữ hiện tại. HTTP 200 không chứng minh dịch vụ S3 hoạt động hoặc đã upload thành công. Ví dụ mặc định:

```json
{
  "status": "ok",
  "storage": "unconfigured",
  "storage_configured": false,
  "max_file_size_bytes": 104857600,
  "scan_status": "not_started",
  "scan_pipeline_enabled": false,
  "metadata_mode": "disabled",
  "metadata_configured": false,
  "owner_mode": "development"
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

```JSON
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

`size_bytes` là số byte server thực sự đọc. `content_type` do client cung cấp hoặc giá trị mặc định; chưa kiểm tra định dạng bằng nội dung và chưa quét PII/malware. `scan_status=not_started` có nghĩa chưa quét. Khi metadata bật, response thêm upload_state và created_at; scan_status lấy từ item sau cập nhật upload, giữ kết quả nếu thành phần ngoài đã xử lý. Khi metadata disabled, response mẫu cũ giữ nguyên.

`key` là định danh lưu trữ tương đối, không phải URL download. UUID riêng cho mỗi request ngăn hai tệp trùng tên ghi đè nhau. Không có idempotency: gửi lại cùng một tệp sẽ tạo object mới.

`storage=local` xác nhận lưu trên đĩa máy chạy API. `S3Storage`, service uploader và factory/config S3 đã được nối trong `app.main:app`. Đặt `MAYSEC_STORAGE_MODE=s3`, bucket/region và cấu hình quyền AWS để sử dụng. Giá trị `s3` trong response upload chỉ được trả sau khi uploader xác nhận ghi hoàn tất. Frontend cũng hiểu response cũ chỉ có `id`/`key`, nhưng không coi việc thiếu `storage` là bằng chứng S3.

### Lỗi

```json
{"detail": "Lý do thất bại"}
```

| HTTP | Khi nào                                                                      |
| ---- | ----------------------------------------------------------------------------- |
| 400  | Tệp rỗng, thiếu tên hợp lệ hoặc lỗi parser multipart                  |
| 413  | Nội dung tệp hoặc tổng body multipart vượt giới hạn cấu hình        |
| 422  | Thiếu trường`file`, sai loại trường hoặc request không khớp schema |
| 503  | Storage/metadata chưa sẵn sàng hoặc chưa xác nhận đủ metadata/audit |
| 502  | Adapter lưu trữ gặp lỗi                                                   |

API không đưa credentials hoặc chi tiết exception nội bộ vào response. Frontend hiển thị lỗi và giữ trạng thái thất bại; không tự chuyển sang mô phỏng.

Các lỗi trong bảng là lỗi upload do ứng dụng xử lý. OPTIONS/preflight của CORS middleware có thể trả văn bản. GET `/` chưa có route (404); GET `/upload` không được hỗ trợ (405).

### CORS

Mặc định cho phép `http://localhost:5173` và `http://127.0.0.1:5173`, methods `GET`, `POST`, `OPTIONS` và header `Content-Type`, không bật cross-origin credentials. Nếu Vite chuyển sang port khác hoặc chạy trên host khác, cấu hình `MAYSEC_CORS_ORIGINS` tương ứng ở API và khởi động lại. Origin gồm protocol, hostname và port; `localhost` và `127.0.0.1` là hai origin khác nhau.

CORS là quy tắc cho trình duyệt, không phải xác thực hay kiểm tra quyền. API hiện chưa hỗ trợ cookie/token.

### Gọi bằng PowerShell

```powershell
Set-Location 'D:\Cloud UET\MaySec'
# Thay bằng đường dẫn tới file có sẵn trên máy bạn.
$sourceFile = 'C:\duong-dan-cua-ban\tai-lieu.txt'
curl.exe -i -F "file=@$sourceFile" 'http://127.0.0.1:8000/upload'
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

**Trạng thái: service và adapter đã triển khai cùng contract; cần nghiệm thu AWS thật.** Bạn sở hữu adapter/API/factory; Sang sở hữu service và cấu hình AWS, cùng thống nhất SDK settings. Typed interface `S3Uploader` trong `backend/app/services/s3_storage.py` là điểm bàn giao của code Python. Không đổi chữ ký hoặc kiểu trả về riêng lẻ giữa hai bên.

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

| Đầu vào          | Yêu cầu                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `file_obj`        | Binary file-like đã validation và rewind về đầu; không đọc toàn bộ thành bytes chỉ để upload                                                   |
| `key`             | API sinh dạng`uploads/dev-user/UUID/safe-name`; service giữ nguyên, không tự sinh UUID khác                                                           |
| `content_type`    | API truyền từ request hoặc`application/octet-stream`; service truyền vào `ExtraArgs.ContentType`; đây chưa phải xác minh định dạng nội dung |
| `client`          | S3 client tạo từ config/factory phía server, có thể thay bằng stub trong tests                                                                          |
| `bucket`          | Bucket phía server; không lấy từ browser                                                                                                                  |
| `transfer_config` | Boto3 TransferConfig đã tạo ngoài adapter; service chuyển vào tham số`Config` của upload_fileobj                                                    |

**Quy tắc trả kết quả:** service gọi `client.upload_fileobj(...)`, chờ thao tác hoàn tất rồi `return key`. SDK upload_fileobj có thể trả `None` khi thành công; wrapper của Sang phải chuyển thành chuỗi key. Không nuốt exception rồi trả `None`. Adapter từ chối `None`, boolean hoặc key khác. Chuỗi key chỉ là xác nhận theo contract, không tự chứng minh bytes trên S3 nếu uploader viết sai; nghiệm thu vẫn phải đối chiếu hash trên AWS thật.

Service không tạo presigned URL để thay cho ghi file, không giữ handle sau request và không chịu trách nhiệm validation/UUID/schema HTTP. Cleanup handle cuối request do route thực hiện. Bucket/credentials không được đưa vào response upload.

| Trường hợp                                                                       | Adapter                                         | HTTP qua route hiện có |
| ----------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------ |
| Thiếu bucket/client/transfer config/uploader                                       | StorageUnavailable; không gọi service         | 503                      |
| Thiếu credentials, thiếu một phần credentials hoặc region khi service gọi SDK | StorageUnavailable                              | 503                      |
| ClientError, lỗi SDK khác hoặc I/O                                               | StorageFailure                                  | 502                      |
| Service tự ném StorageUnavailable/StorageFailure                                  | Giữ nguyên loại lỗi                         | 503/502                  |
| Service trả kết quả không đúng contract                                       | StorageFailure                                  | 502                      |
| Lỗi ngoài các loại trên                                                        | Route bắt lỗi bất ngờ, không lộ chi tiết | 502                      |

`configured=True` chỉ nói dependencies đã được cung cấp; không chứng minh IAM/bucket/mạng hoạt động. Adapter không tự retry POST, không tạo client hoặc import s3_service ở module scope. Retry SDK thuộc service của Sang. Lỗi sau khi S3 có thể đã ghi không tự retry bằng UUID mới.

`main.py` đã nối uploader vào điểm khởi động Uvicorn:

```python
from .services.s3_service import upload_to_s3

app = create_app(s3_uploader=upload_to_s3)
```

Service không tạo AWS client lúc import. Factory tạo S3 client/TransferConfig khi storage mode là `s3`, sử dụng credentials chain của Boto3 và đóng client thuộc app khi shutdown. Local/unconfigured không tạo S3 client. DynamoDB là lựa chọn độc lập: metadata=dynamodb tạo DB client ở lifespan, kể cả khi storage=local. Factory cho phép inject storage/uploader và dynamodb_client để test; client inject không bị app đóng. Gọi create_app(settings) trong S3 mode mà thiếu uploader sẽ báo storage chưa sẵn sàng, khác entrypoint app.main:app đã nối uploader.

`S3_BUCKET_NAME` và `AWS_REGION` bắt buộc khi chọn mode S3; thiếu sẽ báo lỗi cấu hình lúc khởi động. `configured=true` không kiểm tra bucket/IAM/mạng. Nếu tạo client thất bại, upload trả 503; nếu SDK không xác nhận ghi, upload trả 502. Sau khi sửa cấu hình khởi tạo, restart API.

SDK mặc định dùng threshold 16 MiB, chunk 8 MiB, concurrency 2 và classic transfer manager. Đây là settings khởi điểm, không phải giới hạn request upload đồng thời. Settings đọc biến môi trường; dùng Uvicorn `--env-file .env` nếu muốn nạp file `.env`.

Kiểm thử bàn giao gồm adapter/service với client giả, Boto3 Stubber và HTTP local. Tests không dùng tài khoản AWS. Demo AWS thật phải kiểm key, SHA256 và workflow; scan_status khởi tạo not_started khi pipeline tắt hoặc scanning khi cờ S3 pipeline bật. Các bước upload nằm trong [upload-test-guide.md](upload-test-guide.md); cấu hình pipeline và đọc trạng thái nằm trong [hướng dẫn DB/API](dynamodb-fastapi-local-test-guide.md).

## Chức năng chưa triển khai

Chưa có download, xóa object, HTTP history/admin, login hoặc triển khai writer DB/nhánh lỗi Lambda trong lần sửa backend này. API đã hỗ trợ cấu hình pipeline S3 và đọc kết quả, chưa chứng minh hạ tầng AWS thật. Read API lấy owner từ dependency dev-user, không tin owner_id query do caller chọn, nhưng đây chưa phải xác thực nhiều người. React chưa nạp GET /files hoặc polling; refresh vẫn mất danh sách UI. Nút bỏ khỏi danh sách không xóa file đã lưu.

## Metadata và API đọc

- Khi metadata bật, thứ tự POST /upload: validation → conditional metadata + upload_started audit → storage → update upload_state + upload_completed audit → 201. Không ghi đè scan status. Lỗi storage cố gắng ghi failed/unknown và upload_failed audit.
- DB lỗi trước storage: 503, không ghi byte. DB lỗi sau storage: 503, file có thể đã tồn tại; header X-File-Id/X-File-Key giúp đối soát. Metadata và audit chưa nằm trong transaction chung.
- GET /files?limit=20&cursor=...: Query owner hiện tại, limit 1–100, trả items và next_cursor. Thứ tự theo file_id. Cursor là base64 JSON nội bộ, được kiểm schema và owner; không phải token cấp quyền.
- GET /files/{id}/status: GetItem đủ owner hiện tại + id; trả id, scan_status, upload_state, updated_at, status_reason, findings_count, finding_types, scanned_at, quarantined_at. 404 nếu không tồn tại. List có cùng summary.
- Metadata disabled/chưa sẵn sàng hoặc lỗi đọc DB: 503. Cursor sai/khác owner: 400. Query validation: 422 với thông báo tham số, không dùng thông báo multipart.
- Health bổ sung metadata_mode, metadata_configured, owner_mode=development và scan_pipeline_enabled. scan_status trên health là trạng thái khởi tạo theo cấu hình; không phải kết quả của file hoặc probe AWS. Configured chỉ phản ánh client/repository đã tạo, không chứng minh IAM hay khả năng ghi.

Schema item và giới hạn hiện tại: [dynamodb-item-schema.md](dynamodb-item-schema.md). Test offline không gọi AWS: python -m pytest -q trong backend; bộ hiện có 119 test. Script scripts/check_local_api.py kiểm thêm 8 bước HTTP thật trên loopback với AWS tắt.

## Pipeline và kết quả theo bàn giao mới

- MAYSEC_SCAN_PIPELINE_ENABLED mặc định false; true chỉ hợp lệ khi MAYSEC_STORAGE_MODE=s3 và MAYSEC_METADATA_MODE=dynamodb. Giá trị env nhận true/false/1/0, bỏ khoảng trắng và không phân biệt hoa/thường. Sai cấu hình gây lỗi khi khởi động.
- Khi bật: metadata scanning được tạo trước upload S3, key uploads/{owner_id}/{file_id}/{safe_filename}; backend không gọi Step Functions/Lambda. S3/EventBridge đã cấu hình phải tự kích hoạt pipeline.
- Sau upload chỉ xác nhận upload_state; không ghi đè kết quả Scan. Nếu lỗi upload chắc chắn, best effort chuyển scanning -> error khi upload_state=failed. Nếu timeout/không xác định thì giữ unknown để đối soát, không tự kết luận Scan lỗi.
- scan_status nhận not_started, scanning, safe, flagged, quarantined, quarantine_delete_failed, unscanned, error. Poll tiếp khi scanning hoặc flagged, có timeout/backoff. quarantine_delete_failed là trạng thái cần xử lý, không phải đã cách ly hoàn tất.
- POST giữ các trường response cũ; list/status trả summary có default 0/[] và timestamp nullable. Không trả scan_result, findings/location hoặc chi tiết S3/KMS của cách ly.
- Canonical status_reason ưu tiên hơn reason cũ. Khi summary top-level thiếu/còn 0/[], có thể tổng hợp từ scan_result.findings hoặc finding_counts (Map loại -> số nguyên không âm). Không tự chuyển status từ scan_result. Writer Lambda cần cập nhật canonical summary cùng kết quả để không tạo dữ liệu mâu thuẫn.
- scanned_at và quarantined_at chấp nhận UTC/offset, chuẩn hóa UTC milliseconds. Summary sai kiểu, count âm/bool, timestamp thiếu timezone hoặc trạng thái lạ trả 503 với lỗi đã lọc.

Ví dụ GET /files/{id}/status sau khi Scan phát hiện PII:

```json
{
  "id": "a-uuid-generated-by-server",
  "scan_status": "flagged",
  "upload_state": "uploaded",
  "updated_at": "2026-10-23T03:00:00.000Z",
  "status_reason": null,
  "findings_count": 1,
  "finding_types": ["CREDIT_CARD"],
  "scanned_at": "2026-10-23T03:00:00.000Z",
  "quarantined_at": null
}
```

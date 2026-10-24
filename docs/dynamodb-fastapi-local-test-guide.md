# Test FastAPI: file local và metadata DynamoDB

Cập nhật 23/10/2026 theo bàn giao mới. Project: `G:\code\BTL_Cloud_2627I_INT3319_1`.

## 1. Đã ghép gì?

- `main.py`: tạo DB client/repository trong lifespan; đóng client do app sở hữu, không đóng client inject để test.
- `dependencies.py`: cấp repository files/audit và owner phát triển cố định `dev-user`.
- `routers/files.py`: metadata + audit trước storage, xác nhận upload + audit sau storage; GET /files và GET /files/{id}/status.
- `schemas/file.py`: giữ response upload cũ và thêm schema metadata/list/status.

Chưa có auth, HTTP history/download/delete/admin hoặc React list/polling. Mọi request dùng `dev-user`; chỉ test nội bộ trên loopback, chưa phải phân quyền nhiều người. Backend không gọi Lambda/Step Functions trực tiếp. Local hoặc pipeline tắt dùng not_started; S3 + metadata + pipeline bật dùng scanning và dựa vào trigger S3/EventBridge đã có. Cập nhật upload giữ kết quả nếu Lambda đã đổi status.

API nhận đủ not_started, scanning, safe, flagged, quarantined, quarantine_delete_failed, unscanned, error. List/status trả thêm findings_count, finding_types, scanned_at, quarantined_at, status_reason; không trả findings/location, scan_result, bucket cách ly hoặc KMS. Có alias reason và phần tóm tắt scan_result dạng Map để tương thích bàn giao. Xem [hợp đồng API](api-contract.md).

| Cách test | Byte file | Metadata | Cần AWS? |
|---|---|---|---|
| Pytest | Thư mục tạm thật | SDK Stubber | Không |
| API local + disabled | backend/data | Không ghi DB; list/status trả 503 | Không |
| API local + dynamodb | backend/data | Hai bảng AWS thật | Có |

## 2. Test tự động không gọi AWS

```powershell
Set-Location 'G:\code\BTL_Cloud_2627I_INT3319_1\backend'
.\.venv\Scripts\python.exe -m pytest -q
```

Nếu thiếu thư viện, cài requirements-dev.txt bằng chính Python venv. Bộ hiện tại có **119 test** về repository/script, API và cấu hình pipeline. AWS call đều giả lập, file local và SHA256 kiểm thật. Test HTTP dùng TestClient; sandbox hạn chế file tạm/kết nối nội bộ có thể cần quyền chạy ngoài sandbox. Cảnh báo deprecation httpx/TestClient hiện không làm test thất bại.

Đã kiểm: upload/list/status, audit, đọc qua app mới, race với Scan, pagination và cursor khác owner, DB lỗi trước/sau storage, storage lỗi, đóng handle/client, CORS và response cũ khi metadata disabled. Chưa chứng minh AWS/Lambda thật; kiểm owner dependency không phải kiểm đăng nhập thật.

Test bổ sung cho bàn giao: tám trạng thái, summary của Scan, reason cũ/canonical, UTC, dữ liệu summary lỗi, S3 pipeline bật/tắt, giữ flagged/quarantined khi Lambda chạy trước response, upload thất bại chắc chắn chuyển scanning sang error có điều kiện, upload chưa xác định không tự kết luận Scan lỗi. S3 trong test dùng adapter thật với uploader offline ghi file tạm; không gọi AWS.

### Kiểm tra bằng server HTTP thật, không AWS

```powershell
.\.venv\Scripts\python.exe scripts/check_local_api.py
```

Script tự chọn cổng loopback, chạy Uvicorn với storage local/metadata disabled/pipeline false, kiểm health, OpenAPI, Swagger, upload và SHA256, file rỗng 400, quá lớn 413, API đọc metadata tắt 503. Kỳ vọng **8 PASS**, kết quả cuối result=PASS, aws=false. Script tự dừng server và dọn thư mục tạm do nó tạo trong backend/.test-tmp; không đụng dữ liệu backend/data hoặc server bạn đang chạy. Không đọc backend/.env, các biến mode bị ghi đè riêng trong tiến trình con.

## 3. Chạy API local hoàn toàn, chưa gọi AWS

### Terminal 1

```powershell
Set-Location 'G:\code\BTL_Cloud_2627I_INT3319_1\backend'
$env:MAYSEC_STORAGE_MODE = 'local'
$env:MAYSEC_LOCAL_STORAGE_DIR = 'data'
$env:MAYSEC_METADATA_MODE = 'disabled'
$env:MAYSEC_SCAN_PIPELINE_ENABLED = 'false'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --env-file .env
```

Biến terminal ưu tiên hơn .env; lệnh này không cần profile AWS. Mở `/docs` để dùng Swagger. Health cần storage=local, metadata_mode=disabled, metadata_configured=false.

### Terminal 2: upload và lưu response

```powershell
Set-Location 'G:\code\BTL_Cloud_2627I_INT3319_1\backend'
Invoke-RestMethod 'http://127.0.0.1:8000/health'
New-Item -ItemType Directory -Path '.\.test-tmp' -Force | Out-Null
$sourceFile = Join-Path (Get-Location).Path '.test-tmp\api-local-test.txt'
Set-Content -LiteralPath $sourceFile -Value 'MaySec local upload test' -Encoding utf8
$headersFile = Join-Path (Get-Location).Path '.test-tmp\upload-headers.txt'
$uploadJson = curl.exe -sS --fail-with-body -D $headersFile -F "file=@$sourceFile" 'http://127.0.0.1:8000/upload'
if ($LASTEXITCODE -ne 0) {
    $uploadJson
    Get-Content -LiteralPath $headersFile
    throw 'Upload failed; inspect response and recovery IDs before retrying.'
}
$uploaded = $uploadJson | ConvertFrom-Json
$uploaded
```

Kỳ vọng HTTP 201, storage=local, scan_status=not_started. Response không thêm upload_state/created_at khi metadata tắt.

### Chứng minh byte lưu đúng

```powershell
$storedFile = Join-Path (Join-Path (Get-Location).Path 'data') $uploaded.key
$sourceHash = (Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash
$storedHash = (Get-FileHash -LiteralPath $storedFile -Algorithm SHA256).Hash
if ($sourceHash -ne $storedHash) { throw 'SHA256 mismatch' }
'PASS: local file SHA256 matches'
```

GET /files và status khi metadata disabled trả **503**: chưa có nguồn metadata để đọc. Đây là hành vi cấu hình mong đợi, không trả danh sách rỗng giả.

## 4. Giữ file local, bật metadata/audit lên AWS thật

Làm sau phần 2–3. Phần này ghi item vào AWS, byte file vẫn ở local. API dùng credential chain và không tự kiểm account allowlist; đối chiếu get-caller-identity với account nhóm trước khi start.

### Terminal 1: Ctrl+C để dừng API, rồi chạy

```powershell
Set-Location 'G:\code\BTL_Cloud_2627I_INT3319_1\backend'
$env:AWS_PROFILE = 'securedrive-key'
aws sts get-caller-identity --profile securedrive-key --no-cli-pager
$env:MAYSEC_STORAGE_MODE = 'local'
$env:MAYSEC_LOCAL_STORAGE_DIR = 'data'
$env:MAYSEC_METADATA_MODE = 'dynamodb'
$env:MAYSEC_SCAN_PIPELINE_ENABLED = 'false'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --env-file .env
```

.env cần DYNAMODB_REGION=ap-southeast-2 và ba tên securedrive- hiện có. Không đổi AWS_REGION của S3 để cấu hình DB. Credentials lấy từ profile, không ghi key vào source/frontend.

### Terminal 2

1. Gọi health: metadata_mode=dynamodb, metadata_configured=true. Đây chỉ xác nhận đã tạo client/repository, chưa chứng minh IAM/bảng hoạt động.
2. Chạy lại đoạn upload phần 3, nhận ID mới. Kỳ vọng 201, storage=local, upload_state=uploaded, scan_status=not_started và created_at.
3. Chạy lại SHA256.
4. Đọc qua API:

```powershell
Invoke-RestMethod 'http://127.0.0.1:8000/files?limit=20' | ConvertTo-Json -Depth 6
Invoke-RestMethod "http://127.0.0.1:8000/files/$($uploaded.id)/status"
```

List trả items + next_cursor, thứ tự theo file_id chứ không theo thời gian. Dùng next_cursor nếu quá một trang. Status phải trả đúng ID, upload_state=uploaded và scan_status=not_started.

### Kiểm tra Console và restart

- `securedrive-files`: Query owner_id=`dev-user`, file_id bằng `$uploaded.id`; kiểm key, size, storage, upload_state và status.
- `securedrive-audit-log`: Query cùng file_id; kỳ vọng upload_started và upload_completed. Owner dev-user khác db-smoke-test của script repository trước.
- Dừng/chạy lại API với cùng cấu hình, đọc lại list/status. Metadata ở DB và file local vẫn còn.
- Upload khi metadata disabled không tự có item DB khi bật lại. React chưa gọi GET /files nên refresh UI vẫn có thể mất danh sách trong bộ nhớ dù API đọc lại được.

## 5. Lỗi và đối soát

| Trường hợp | Kết quả |
|---|---|
| File rỗng/tên trắng/quá lớn/thiếu field | 400/413/422, chưa ghi DB |
| Storage unconfigured | 503, chưa tạo metadata |
| DB bật nhưng client chưa sẵn sàng | 503, chưa lưu byte |
| Metadata/audit ban đầu lỗi | 503, không gọi storage |
| StorageUnavailable sau metadata | 503, cố gắng ghi failed và audit lỗi |
| Storage không xác nhận ghi | 502, cố gắng ghi unknown và audit lỗi |
| DB lỗi sau khi byte đã lưu | 503; giữ file và ID để đối chiếu |
| Metadata disabled, gọi list/status | 503 |
| File không tồn tại theo owner hiện tại | 404 |
| Cursor sai/khác owner | 400 |
| Limit ngoài 1–100 | 422 với thông báo tham số |
| Lỗi DB khi đọc | 503, không che bằng items=[] |
| Item cũ/không đúng schema | 503; cần kiểm item/backfill có kiểm chứng |

Sau khi đã sinh ID, lỗi upload có thể có header **X-File-Id**, **X-File-Key**. File `.test-tmp/upload-headers.txt` giữ các header để kiểm tra; chúng được expose qua CORS. Không chạy lại upload khi chưa biết lần trước đã ghi hay chưa: mỗi request hiện sinh UUID mới. Lỗi public giữ dạng `{"detail":"..."}` và không trả raw provider message.

Metadata và audit hiện là hai thao tác độc lập; không có transaction chung DB–local/S3, không tự rollback file. Scope hiện tại chưa có cơ chế phục hồi tổng thể, auth hoặc Lambda integration. Dùng stub để test lỗi, không tháo quyền/phá tài nguyên nhóm.

## 6. Điều kiện hoàn thành

- Offline pass; metadata disabled vẫn giữ luồng upload cũ.
- SHA256 byte local đúng.
- Khi bật DB: metadata/audit đúng, list/status đọc lại sau restart.
- Ghi rõ đã test offline hay AWS thật. Local+DynamoDB không chứng minh S3/Lambda/quarantine/notification.

Tiếp theo: xác nhận FastAPI với AWS thật, ghép phần ghi DB của Lambda theo schema, auth/owner thật, history/admin và React list/polling. Tham khảo [schema](dynamodb-item-schema.md) và [test repository](dynamodb-service-test-guide.md).

## 7. Cấu hình S3 pipeline sau khi phía AWS đã sẵn sàng

Chỉ dùng cấu hình sau với bucket upload thật đã nối EventBridge/Step Functions và các Lambda đã ghi đúng bảng/khóa. Đây là bước AWS thật, không phải cách giả lập Scan trên local.

```dotenv
MAYSEC_STORAGE_MODE=s3
S3_BUCKET_NAME=<bucket-upload-thuc-te>
AWS_REGION=<region-cua-bucket>
MAYSEC_METADATA_MODE=dynamodb
MAYSEC_SCAN_PIPELINE_ENABLED=true
DYNAMODB_REGION=ap-southeast-2
DYNAMODB_FILES_TABLE=securedrive-files
DYNAMODB_AUDIT_TABLE=securedrive-audit-log
DYNAMODB_USERS_TABLE=securedrive-users
```

Không copy nguyên placeholder bucket/region. Cờ pipeline mặc định false, nhận true/false/1/0; giá trị khác gây lỗi cấu hình. Bật cờ với local hoặc metadata disabled bị từ chối khi khởi động. Health có scan_pipeline_enabled; scan_status của health chỉ là trạng thái khởi tạo theo cấu hình, không phải trạng thái file hay bằng chứng pipeline/IAM hoạt động.

- Metadata được tạo trước S3: owner_id=dev-user, file_id=UUID, status=scanning, upload_state=uploading.
- S3 nhận key uploads/dev-user/UUID/safe_filename; EventBridge tự kích hoạt. Backend không khởi chạy workflow lần nữa.
- Backend xác nhận upload_state=uploaded; giữ nguyên status Lambda đã ghi.
- Client tiếp tục polling khi scanning **hoặc flagged**; trạng thái kết thúc là safe/quarantined/quarantine_delete_failed/unscanned/error. Có timeout/backoff và đối soát workflow, không tự kết luận lỗi cách ly chỉ vì chờ lâu.
- StorageUnavailable hoặc audit ban đầu lỗi: best effort ghi upload_state=failed, rồi chỉ đổi status=scanning sang error khi upload_state=failed vẫn đúng. Conditional conflict không ghi đè kết quả Scan.
- StorageFailure/timeout chưa xác định: upload_state=unknown; không ép status=error vì object và workflow có thể đã tồn tại. Kiểm X-File-Id/X-File-Key và AWS trước retry.
- Phần ghi kết quả Scan/Quarantine/Notify và nhánh lỗi workflow vẫn phải triển khai bên AWS. Backend không tự thêm bảng, GSI, IAM hoặc cập nhật Lambda.

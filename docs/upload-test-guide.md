# Tự kiểm tra upload local và S3 — phương án A

Luồng đã nối: frontend → POST /upload → S3Storage → upload_to_s3 → S3. `app.main:app` truyền uploader của Sang vào `create_app`. Mặc định vẫn là `unconfigured`; phải chọn nơi lưu trước khi upload. Dùng file của bạn, không cần file mẫu trong repo.

## 1. Kiểm tra code mà không cần AWS

Từ PowerShell:

```powershell
cd 'D:\Cloud UET\MaySec\backend'
# Chỉ tạo .venv nếu chưa có.
if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
    py -3 -m venv .venv
}
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
$env:MAYSEC_STORAGE_MODE = 'unconfigured'
.\.venv\Scripts\python.exe -m pytest -q
```

Phải không có FAILED. Tests kiểm tra validation, local storage, config, adapter, service thật và điểm khởi động. Boto3 Stubber kiểm tra upload nhỏ và multipart 17 MiB bằng phản hồi giả lập; không gọi AWS thật. Bản lúc viết hướng dẫn có 70 tests; số lượng có thể tăng khi bổ sung chức năng.

## 2. Upload local thật trước

Terminal 1, từ `backend/`:

```powershell
$env:MAYSEC_STORAGE_MODE = 'local'
$env:MAYSEC_LOCAL_STORAGE_DIR = 'data'
$env:MAYSEC_MAX_FILE_SIZE_BYTES = '104857600'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Mở http://127.0.0.1:8000/health: `storage=local`, `storage_configured=true`. Mở http://127.0.0.1:8000/docs → POST /upload → Try it out → chọn một file có nội dung, dưới 100 MiB → Execute. Phải trả HTTP 201 và `storage=local`.

Có thể dùng terminal 2 để upload và so hash. Thay đường dẫn trong `$sourceFile` bằng file thật:

```powershell
cd 'D:\Cloud UET\MaySec\backend'
$sourceFile = 'C:\duong-dan-cua-ban\tai-lieu.pdf'
$result = curl.exe --fail-with-body --silent --show-error -F "file=@$sourceFile" 'http://127.0.0.1:8000/upload' | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $result.storage -ne 'local' -or -not $result.key) {
    throw 'Upload local chưa được xác nhận'
}
$savedFile = Join-Path '.\data' $result.key
$sourceHash = (Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash
$savedHash = (Get-FileHash -LiteralPath $savedFile -Algorithm SHA256).Hash
$result
"Hash khop: $($sourceHash -eq $savedHash)"
```

`Hash khop: True` chứng minh nội dung nguồn và file lưu giống nhau. File nguồn và file lưu phải là hai đường dẫn khác nhau. Nếu dùng storage root khác, đổi đường dẫn `$savedFile` tương ứng.

## 3. Chuyển sang S3 thật

Sang cung cấp tên bucket, region và cách truy cập AWS cho máy chạy backend. Nếu dùng AWS profile, profile phải được cấu hình sẵn trên máy; tên profile ví dụ bên dưới không tự tạo credentials. Backend cần quyền ghi/multipart vào prefix upload. Người tải file để so hash cần quyền đọc object.

Dừng server ở terminal 1 bằng Ctrl+C rồi chạy:

```powershell
cd 'D:\Cloud UET\MaySec\backend'
$env:MAYSEC_STORAGE_MODE = 's3'
$env:S3_BUCKET_NAME = 'TEN-BUCKET-THUC-TE'
$env:AWS_REGION = 'REGION-CUA-BUCKET'
# Chỉ đặt AWS_PROFILE nếu Sang hướng dẫn dùng profile có sẵn.
# $env:AWS_PROFILE = 'TEN-PROFILE-DA-CAU-HINH'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

`/health` cần trả `storage=s3`, `storage_configured=true`; điều này chỉ xác nhận dependencies, chưa chứng minh quyền ghi S3. Thử POST /upload qua Swagger bằng file của bạn; phải trả 201 và `storage=s3`. Copy chính xác `key` trong response.

Trong AWS Console → S3 → bucket được cấu hình → tìm object đúng key → download object về một đường dẫn khác file nguồn. So sánh:

```powershell
$sourceFile = 'C:\duong-dan-cua-ban\tai-lieu.pdf'
$downloadedFile = 'C:\duong-dan-file-tai-ve\tai-lieu.pdf'
$sourceHash = (Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash
$downloadedHash = (Get-FileHash -LiteralPath $downloadedFile -Algorithm SHA256).Hash
"Hash khop: $($sourceHash -eq $downloadedHash)"
```

Phải là True. Không dùng ETag làm SHA256. Khi dùng Console, đừng đổi filename hoặc nội dung file nguồn giữa lúc upload và so hash.

## 4. Kiểm tra qua frontend và nhiều file

Terminal khác:

```powershell
cd 'D:\Cloud UET\MaySec\frontend'
pnpm.cmd run dev --port 5173 --strictPort
```

Nếu máy chưa cài dependencies frontend, chạy `pnpm.cmd install --frozen-lockfile` trước. Mở http://127.0.0.1:5173 → Kết nối lưu trữ → chọn chế độ API → URL http://127.0.0.1:8000. Mặc định frontend là demo; phải chuyển sang API để gửi file thật.

- Một file nhỏ: nhãn cuối là Đã lưu local hoặc Đã lưu S3 đúng mode backend.
- Chọn vài file cùng lúc: queue xử lý tuần tự; mỗi file có response/key riêng.
- Upload cùng file hai lần: ID/key khác nhau; không ghi đè object trước.
- Một file trên 16 MiB, dưới 100 MiB: thử đường multipart khi dùng S3; tải về và so hash.
- Chọn file lớn: API vẫn phải đáp ứng health; ghi lại thời gian, lỗi và kết quả hash, không suy ra công suất nhiều người dùng chỉ từ một lần thử.

## 5. Kiểm tra lỗi

| Thử nghiệm | Kết quả mong đợi |
|---|---|
| POST /upload không gửi file | 422, detail là chuỗi |
| Chọn file rỗng | Frontend chặn; nếu gửi qua Swagger/API thì 400 |
| File quá giới hạn | Frontend chặn hoặc API trả 413 |
| Restart với mode unconfigured rồi gửi file hợp lệ | 503 |
| AWS thiếu credentials | 503; khởi tạo client có thể lỗi trước upload |
| Bucket sai/không có quyền ghi/lỗi mạng | 502 nếu lỗi xảy ra khi upload; 503 nếu không tạo được client |

Để thử API trả 413 bằng file sẵn có: dừng server, đặt `MAYSEC_MAX_FILE_SIZE_BYTES=1024`, chạy lại và gửi file lớn hơn 1 KiB qua Swagger. Sau đó dừng server, đặt lại `104857600` và restart. Không cần tạo file test mới.

Không tự thay đổi IAM hoặc bucket thật để tạo lỗi; tests tự động đã giả lập lỗi quyền và mạng. Sau timeout/hủy/lỗi không rõ kết quả, kiểm tra server/S3 trước khi thử lại vì chưa có idempotency.

## 6. Kết luận nghiệm thu

Upload đạt khi response đúng, object đúng key, hash khớp, file trùng tên không ghi đè, lỗi không báo thành công và local/unconfigured vẫn chạy. Ghi lại commit, mode, file size, HTTP status, key và kết quả hash để cả hai đối chiếu.

`scan_status=not_started` vẫn đúng: chưa có metadata/status API, UI polling, quét/mã hóa/cách ly theo nghiệp vụ. Chưa có giới hạn số request upload đồng thời trước parser; hàng đợi frontend hiện tuần tự và SDK concurrency chỉ áp dụng mỗi upload. Các phần này thuộc mốc tiếp theo, chưa được nghiệm thu qua hướng dẫn upload này.

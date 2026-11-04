> **Tài liệu tham chiếu lịch sử.** Các mốc tính năng, giới hạn và lệnh script/test bên dưới thuộc bản trước. Cài/chạy theo [API guide hiện hành](api-guide.md), endpoint theo [API contract](api-contract.md), triển khai AWS theo [handoff](AWS-HANDOFF-QUICKSTART-2026-10-31.md). Không cần khôi phục script/test cũ.

# Test frontend → FastAPI → S3 → Lambda → DynamoDB

Muốn thao tác hoàn toàn thủ công, không chạy script: xem [hướng dẫn kiểm tra thủ công](aws-pipeline-manual-test-guide.md).

Cập nhật 25/10/2026. Dùng khi bên AWS đã sửa đúng tên bảng, khóa và test Lambda.

Luồng thực tế: frontend POST /upload → backend tạo metadata/audit → upload S3 → EventBridge/Step Functions → Scan/Quarantine/Notify cập nhật DB → API đọc kết quả. Frontend không truy cập DynamoDB trực tiếp.

## 1. Chuẩn bị

- Profile `securedrive-key` đã có trên máy. Không cấu hình lại key nếu đang dùng được.
- Biết tên bucket upload và region S3 thật; không mặc định suy ra từ region DynamoDB.
- Trigger nhận prefix `uploads/` và key `uploads/dev-user/{file_id}/{filename}`.
- Backend profile có PutObject trên bucket upload và quyền DynamoDB hiện có. Script đối chiếu cần thêm GetObject, GetItem/Query; object mã hóa KMS có thể cần quyền giải mã phù hợp.
- Lambda execution role có quyền ghi đúng bảng, độc lập với profile local.
- Mở ba terminal PowerShell. Giữ backend/frontend chạy trong terminal 1/2; terminal 3 dùng để kiểm tra.
- Lần test đầu dùng file text sạch để đối chiếu hash trên bucket upload. Nếu workflow có Notify thì có thể phát thông báo thật theo cấu hình nhóm.

Không sửa/xóa bảng để test. Thử upload sinh object, metadata và có thể kích hoạt workflow thật; script kiểm tra chỉ đọc.

## 2. Terminal 1 — kiểm tài khoản và chạy backend

Chạy từng khối dưới đây. Thay hai placeholder đầu bằng tài nguyên nhóm đã xác nhận:

```powershell
Set-Location 'G:\code\BTL_Cloud_2627I_INT3319_1\backend'

$env:AWS_PROFILE = 'securedrive-key'
$env:S3_BUCKET_NAME = 'THAY_TEN_BUCKET_UPLOAD'
$env:AWS_REGION = 'THAY_REGION_BUCKET'

$env:MAYSEC_STORAGE_MODE = 's3'
$env:MAYSEC_METADATA_MODE = 'dynamodb'
$env:MAYSEC_SCAN_PIPELINE_ENABLED = 'true'
$env:DYNAMODB_REGION = 'ap-southeast-2'
$env:DYNAMODB_FILES_TABLE = 'securedrive-files'
$env:DYNAMODB_AUDIT_TABLE = 'securedrive-audit-log'
$env:DYNAMODB_USERS_TABLE = 'securedrive-users'
$env:MAYSEC_CORS_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173'

aws sts get-caller-identity --profile securedrive-key --region ap-southeast-2 --no-cli-pager
```

Account dự kiến `018913575473`. Nếu khác, kiểm tra profile trước khi upload. Các biến `$env:` áp dụng terminal này và process con; không sửa file `.env`. AWS credentials dạng biến môi trường còn tồn tại có thể ảnh hưởng lựa chọn danh tính; đối chiếu tài khoản/role đã được cấp.

Kiểm ba bảng:

```powershell
foreach ($table in @('securedrive-files', 'securedrive-audit-log', 'securedrive-users')) {
    aws dynamodb describe-table --table-name $table --profile securedrive-key --region ap-southeast-2 --query 'Table.{Name:TableName,Status:TableStatus,Keys:KeySchema}' --output json --no-cli-pager
    if ($LASTEXITCODE -ne 0) { throw "Khong doc duoc bang $table" }
}
```

Cần ACTIVE, files có owner_id/file_id, audit có file_id/event_key, users có user_id. DescribeTable không chứng minh quyền đọc/ghi item hoặc S3.

Nếu Uvicorn cũ vẫn chạy cổng 8000, Ctrl+C ở đúng terminal của process đó rồi chạy lại. Không chạy thêm process trên cùng cổng:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Các lệnh trên đã truyền cấu hình bằng terminal, không cần `--env-file`. Nếu chọn lưu vào backend/.env thì dùng TEN_BIEN=gia_tri và chạy Uvicorn với `--env-file .env`; terminal env vẫn ưu tiên. Không trộn các giá trị cũ local/disabled vào lần test này.

## 3. Terminal 2 — chạy frontend

```powershell
Set-Location 'G:\code\BTL_Cloud_2627I_INT3319_1\frontend'
$env:VITE_UPLOAD_MODE = 'api'
$env:VITE_API_BASE_URL = 'http://127.0.0.1:8000'
pnpm.cmd run dev --port 5173 --strictPort
```

Mở http://127.0.0.1:5173. Giao diện phải ở chế độ API, kết nối backend 127.0.0.1:8000. Nếu đang mở hộp chọn kết nối cũ, chọn lại đúng API. Không đặt AWS key/profile vào frontend.

## 4. Terminal 3 — kiểm health và tạo file mẫu sạch

```powershell
Set-Location 'G:\code\BTL_Cloud_2627I_INT3319_1\backend'
Invoke-RestMethod 'http://127.0.0.1:8000/health' | Format-List

$testDir = Join-Path (Get-Location).Path '.test-tmp\aws-e2e'
New-Item -ItemType Directory -Path $testDir -Force | Out-Null
$sourceFile = Join-Path $testDir ('clean-' + [guid]::NewGuid().ToString() + '.txt')
Set-Content -LiteralPath $sourceFile -Value 'MaySec clean pipeline test. No sensitive content.' -Encoding ascii
$sourceFile
```

Health cần storage=s3, storage_configured=true, metadata_mode=dynamodb, metadata_configured=true, scan_pipeline_enabled=true, owner_mode=development. Health chỉ kiểm cấu hình/client, không xác nhận IAM/workflow thành công.

## 5. Upload bằng trình duyệt và lấy file_id

1. F12 → Network → bật ghi request; lọc `upload`.
2. Chọn file có đường dẫn vừa in ở `$sourceFile` và upload từ frontend.
3. Mở request POST `http://127.0.0.1:8000/upload` → Response.
4. Cần HTTP 201, `storage: "s3"`, `upload_state: "uploaded"`. Sao chép trường `id` và giữ `key`.
5. Có thể mở chi tiết file trên UI để xem “ID máy chủ”/“Object key”. Dùng ID máy chủ, không dùng ID tạm phía trình duyệt.

Ví dụ response: id=UUID, key=uploads/dev-user/UUID/clean-....txt. `scan_status` có thể đã safe nếu Lambda chạy nhanh; không bắt buộc phải nhìn thấy scanning.

Frontend hiện chưa polling kết quả; thông báo upload thành công chưa chứng minh Scan/Quarantine/Notify đã xong. Bước sau đọc trạng thái thật.

## 6. Terminal 3 — đọc API và đối chiếu AWS

Giữ terminal 3 đã tạo `$sourceFile`. Điền ID vừa nhận và bucket/region giống terminal 1:

```powershell
$fileId = 'DAN_ID_TU_RESPONSE_UPLOAD'
$bucket = 'THAY_TEN_BUCKET_UPLOAD'
$s3Region = 'THAY_REGION_BUCKET'

Invoke-RestMethod "http://127.0.0.1:8000/files/$fileId/status" | Format-List

.\.venv\Scripts\python.exe scripts/check_aws_pipeline.py --profile securedrive-key --expected-account 018913575473 --file-id $fileId --source-file $sourceFile --bucket $bucket --s3-region $s3Region --timeout 180
```

Script chạy bằng venv backend, dùng profile được chỉ định; không tự đọc `.env` và không phụ thuộc biến của terminal 1. Nó kiểm:

1. STS đúng tài khoản, backend đúng cấu hình S3/DB/pipeline.
2. API cho đúng ID, upload uploaded, quét safe, summary sạch và có scanned_at.
3. Item DynamoDB đúng owner/file, bucket/key, tên file, kích thước và trạng thái.
4. Đọc object S3, so SHA256 với file gốc; dùng source_version_id khi metadata có trường này.
5. Query audit đủ các trang, đúng owner/file và có upload_started, upload_completed, scan_safe. Chờ thêm nếu audit chưa kịp ghi.

Kỳ vọng kết thúc `"result": "PASS"` và exit code 0. Giới hạn chờ không tự biến trạng thái DB thành error.

Tên action Scan trong schema là hợp đồng cần nhóm chốt. Nếu Lambda dùng tên khác tương đương, thay `--scan-audit-action TEN_ACTION_THAT`; đừng chọn một action upload để vượt kiểm tra Scan. Script không yêu cầu số audit chính xác vì còn event Notify/Quarantine.

Để yêu cầu thêm audit thông báo thành công, thêm `--notify-audit-action notify_safe` vào lệnh. Chỉ dùng tên nhóm đã chốt. Notify audit không chứng minh email đã tới hộp thư; cần kiểm riêng bước 7.

Script dành cho file sạch kết thúc safe. Với file PII, dùng quy trình bước 8; không đổi script để coi flagged/error là pass. Script chỉ xác minh một file đã upload, không tự upload/ghi DB/xóa/chạy lại workflow.

## 7. Đối chiếu trên AWS Console

| Nơi | Cách kiểm | Kết quả |
|---|---|---|
| S3 upload bucket | Tìm đúng key từ response | File sạch tồn tại, dung lượng đúng; script đã so hash |
| DynamoDB securedrive-files ở Sydney | Explore items → Query owner_id=dev-user, file_id Equal to ID đầy đủ | status=safe, upload_state=uploaded, key/bucket đúng, có scanned_at |
| DynamoDB securedrive-audit-log | Query file_id=ID đầy đủ, để trống điều kiện event_key | Upload và Scan audit; Notify nếu đã nối |
| Step Functions | Mở execution có Input bucket/key của file vừa upload, đối chiếu execution_id khi DB có | Đi đúng nhánh safe và Notify, execution kết thúc phù hợp |
| Lambda logs | Tra execution/file ID ở các hàm tham gia | Không có lỗi ghi DB, key hoặc AccessDenied |
| SNS/Email | Kiểm bước Notify, SNS message ID và hộp thư đã subscribe | Đúng file, đúng loại thông báo, email nhận được nếu nằm trong phạm vi nghiệm thu |

PASS của script chứng minh dữ liệu/API/S3 và audit được yêu cầu. Script không đọc lịch sử Step Functions, không xác minh implementation scanner, tính duy nhất của audit qua retry, hoặc việc nhận email. Hoàn tất kiểm Console mới đánh dấu phần workflow/notification tương ứng.

## 8. Test PII và lỗi sau khi ca sạch đã pass

Tạo file PII giả, không dùng CCCD/thẻ thật:

```powershell
$piiFile = Join-Path $testDir ('pii-' + [guid]::NewGuid().ToString() + '.txt')
Set-Content -LiteralPath $piiFile -Value 'Synthetic test only. CREDIT_CARD: 4111 1111 1111 1111' -Encoding ascii
$piiFile
```

Mẫu trên khớp regex CREDIT_CARD hiện có trong repo; cần bên Scan xác nhận scanner AWS nhận mẫu/loại file này. Upload từ frontend, lấy ID mới và xem status bằng Invoke-RestMethod hoặc Swagger `/docs`. Mỗi lần POST tạo ID mới, không phải retry cùng event.

| Ca | Kết quả cần đối chiếu |
|---|---|
| PII giả | scanning/flagged → quarantined; findings_count>0, có loại phát hiện và thời gian cách ly |
| Quarantine | DB có vị trí bản cách ly; đối chiếu object đích và việc xóa nguồn theo chính sách/versioning nhóm. Nguồn 404 chưa chứng minh đã xóa hết version cũ |
| Chưa hỗ trợ | unscanned có lý do; không báo safe |
| Scan lỗi | error/audit lỗi, không kẹt scanning |
| Copy lỗi | error và chi tiết/audit lỗi |
| Xóa nguồn lỗi | quarantine_delete_failed, giữ vị trí bản copy; không báo cách ly hoàn tất |
| Notify lỗi | Kết quả file giữ nguyên, có audit lỗi thông báo |
| Cùng event chạy lại | Không trùng sự kiện logic, không lùi trạng thái, không copy/gửi trùng ngoài ý muốn |

Các ca cố ý gây lỗi/replay do bên AWS chạy trong phạm vi test được nhóm thống nhất; không đổi policy/xóa object dùng chung để tạo lỗi. So sánh đúng file_id và execution trước/sau. Quyền profile local không thay thế IAM role Lambda.

## 9. Nếu gặp lỗi

| Hiện tượng | Kiểm tra |
|---|---|
| UI demo, không có POST /upload | Chọn API, URL backend và restart Vite sau đổi env |
| Health local/disabled/false | Đang chạy process/cấu hình cũ; Ctrl+C process đúng rồi chạy lại terminal 1 |
| Upload 502/503 | Đọc log backend và X-File-Id/X-File-Key trong response; kiểm DB/S3 trước khi gửi lại |
| Profile/credentials/account lỗi | Kiểm profile được cấp; không dán key vào React hoặc docs |
| S3 AccessDenied | Kiểm quyền caller cho bucket/object và KMS khi cần; script còn cần GetObject dù upload có thể đã thành công |
| DB AccessDenied | Kiểm đúng action/bảng/Sydney của danh tính đang gọi |
| not_started | Có thể là file local/cũ hoặc backend chưa bật pipeline; dùng ID mới từ lần test S3 đúng cấu hình |
| scanning/flagged quá 180 giây | Kiểm execution/trigger/nhánh lỗi và writer DB; timeout script chưa khẳng định workflow thất bại |
| API 404 | Sai ID/owner; hiện owner mặc định dev-user |
| Missing scanned_at/audit | Writer chưa ghi đủ schema, action tên khác hoặc thiếu quyền. Đối chiếu hợp đồng, không sửa DB thủ công để ép pass |
| Hash khác | Chọn nhầm file gốc/key/version hoặc object bị thay đổi; giữ bằng chứng, kiểm trước khi upload lại |

Không cần thêm GSI hay tạo lại bảng để thực hiện ca sạch này. Auth/admin, UI list/polling và download/xóa có kiểm quyền là các phần việc tiếp theo.

## 10. Lưu bằng chứng và nguồn tham khảo

Lưu file ID, owner, key, thời điểm, kết quả script, execution tương ứng, trạng thái cuối, audit và thông báo. Dữ liệu thử nằm dưới backend/.test-tmp ở local; script không dọn tài nguyên AWS. Dọn đúng dữ liệu test bằng quy trình nhóm, không xóa bảng/bucket dùng chung.

- [Schema DynamoDB](dynamodb-item-schema.md), [API contract](api-contract.md).
- [AWS GetObject](https://docs.aws.amazon.com/boto3/latest/reference/services/s3/client/get_object.html): đọc byte và version của object để đối chiếu.
- [AWS DynamoDB Query](https://docs.aws.amazon.com/boto3/latest/reference/services/dynamodb/client/query.html): dùng LastEvaluatedKey để đọc hết trang audit của một file.

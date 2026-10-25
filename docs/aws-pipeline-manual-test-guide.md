# Hướng dẫn kiểm tra thủ công toàn luồng MaySec trên AWS

Cập nhật: **25/10/2026**.

Project: `G:\code\BTL_Cloud_2627I_INT3319_1`.

Hướng dẫn dùng frontend, các lệnh PowerShell riêng lẻ và AWS Console. Không cần chạy file script kiểm thử hoặc pytest.

## 1. Luồng cần xác nhận

```text
Frontend gửi file tới POST /upload
    → FastAPI tạo metadata và audit upload trong DynamoDB
    → FastAPI upload nội dung lên S3
    → S3/EventBridge kích hoạt Step Functions
    → Lambda Scan xử lý
        ├─ sạch: safe → Notify
        ├─ có PII: flagged → Quarantine → quarantined → Notify
        └─ chưa hỗ trợ/lỗi: unscanned hoặc error
    → Các thành phần ghi kết quả và audit vào DynamoDB
    → GET /files/{file_id}/status đọc kết quả cho frontend/Swagger
```

Nội dung file nằm trên S3; DynamoDB lưu metadata, trạng thái và lịch sử. Frontend gọi backend, không tự kết nối DB bằng AWS key.

Ca đầu tiên dùng **file .txt nhỏ, sạch**, ví dụ nội dung `MaySec clean upload. No sensitive content.`. Có thể tạo bằng Notepad và lưu thành `demo-clean.txt`. Sau khi ca sạch hoàn tất mới thử PII giả.

## 2. Thông tin cần có trước khi chạy

| Thông tin | Giá trị/cách lấy |
|---|---|
| AWS account của nhóm | `018913575473` |
| Profile trên máy | `securedrive-key` |
| Region DynamoDB | Sydney, `ap-southeast-2` |
| Bucket upload | Nhận tên thật từ bên S3; không dùng tên ví dụ |
| Region bucket upload | Nhận region thật từ bên S3; có thể khác region DB |
| Bucket quarantine | Nhận tên thật để kiểm ca PII |
| Step Functions | Nhận tên state machine và region đang triển khai |
| Lambda | Scan, Quarantine, Notify đang chạy trên AWS |
| Trigger | Nhận prefix `uploads/`, giữ đúng key backend tạo |

Quyền cần phối hợp:

- Backend profile có quyền upload S3 và tạo/đọc/cập nhật/Query dữ liệu DynamoDB theo nghiệp vụ. Profile chỉ có quyền DB chưa đủ upload S3.
- Để kiểm object bằng CLI, profile cần quyền đọc object; object mã hóa KMS có thể cần quyền KMS tương ứng khi tải nội dung.
- Quyền xem Console S3, Step Functions và CloudWatch có thể chưa được cấp cho tài khoản DB. Nếu bị AccessDenied, nhờ đúng bên phụ trách đối chiếu cùng file ID; không tự kết luận pipeline hỏng.
- Mỗi Lambda dùng execution role riêng. Quyền profile local không tự cấp quyền cho Lambda.

Giữ ba bảng hiện có:

| Bảng | Partition key | Sort key |
|---|---|---|
| securedrive-files | owner_id (String) | file_id (String) |
| securedrive-audit-log | file_id (String) | event_key (String) |
| securedrive-users | user_id (String) | Không có |

Backend hiện dùng owner cố định `dev-user`; chưa có đăng nhập/phân quyền thật. Ca upload này không tạo user mới trong bảng users. Chạy backend trên loopback `127.0.0.1` như các bước dưới.

## 3. Mở ba terminal PowerShell

Các lệnh dưới dùng **PowerShell** trong VS Code, không phải cú pháp cmd.exe.

| Terminal | Công việc |
|---|---|
| 1 | Cấu hình và giữ backend đang chạy |
| 2 | Cấu hình và giữ frontend đang chạy |
| 3 | Kiểm health/status và dùng AWS CLI khi cần |

`$env:TEN_BIEN = 'gia_tri'` đặt biến cho terminal hiện tại và process được khởi động từ nó. Không sửa file `.env`; terminal khác không tự nhận các biến này.

Hướng dẫn giả định máy đã có AWS CLI, Python venv backend và dependencies frontend như các lần chạy trước. Nếu thiếu, xem backend/README.md và README.md của project để cài môi trường trước; không cần cài thêm bộ test cho quy trình thủ công này.

## 4. Terminal 1 — cấu hình backend và kiểm danh tính

Thay `THAY_TEN_BUCKET_UPLOAD` và `THAY_REGION_BUCKET` bằng hai giá trị thật, rồi chạy:

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
```

Nếu từng đặt access key trực tiếp bằng `$env:` trước đây, có thể xóa các biến credentials cũ khỏi **terminal này** để backend dùng profile đã chọn:

```powershell
Remove-Item Env:AWS_ACCESS_KEY_ID -ErrorAction SilentlyContinue
Remove-Item Env:AWS_SECRET_ACCESS_KEY -ErrorAction SilentlyContinue
Remove-Item Env:AWS_SESSION_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:AWS_SECURITY_TOKEN -ErrorAction SilentlyContinue
```

Các lệnh này không xóa profile hoặc file credentials. Không dán key/secret vào source, frontend hay tài liệu.

Kiểm CLI và tài khoản:

```powershell
aws --version
aws sts get-caller-identity --profile securedrive-key --region ap-southeast-2 --no-cli-pager
```

Cần thấy `Account` là `018913575473` và `Arn` thuộc danh tính được nhóm cấp. Nếu khác, kiểm lại profile trước khi upload. Không cần chạy lại `aws configure` nếu profile đang đúng.

**Bật MAYSEC_SCAN_PIPELINE_ENABLED không tạo hoặc bật trigger AWS.** Trigger và Lambda phải được bên AWS cấu hình sẵn như bạn đã được bàn giao.

## 5. Kiểm ba bảng trên AWS Console trước khi upload

1. Đăng nhập AWS account của nhóm.
2. Với DynamoDB, chọn **Asia Pacific (Sydney)** ở góc trên phải.
3. Vào **DynamoDB → Tables**.
4. Xác nhận ba bảng đều **Active** và khóa đúng bảng ở phần 2.

Không cần tạo lại bảng hoặc thêm GSI để kiểm luồng một file.

Thông báo thiếu quyền `application-autoscaling:DescribeScalingPolicies` trên trang Settings không tự chứng minh quyền đọc/ghi item DynamoDB bị lỗi. Đối chiếu thao tác item và lỗi thực tế riêng.

## 6. Terminal 1 — chạy backend

Nếu process backend cũ đang chạy cổng 8000, Ctrl+C ở đúng terminal đó trước. Sau đó chạy trong terminal 1 đã đặt các biến trên:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Cần thấy:

```text
Application startup complete.
Uvicorn running on http://127.0.0.1:8000
```

Giữ terminal này mở để xem log request.

Ở cách chạy này, cấu hình đã được truyền qua terminal nên không cần `--env-file`. Nếu muốn dùng backend/.env thay thế, xem phần 16; tránh trộn hai cách với giá trị khác nhau.

## 7. Terminal 2 — chạy frontend ở chế độ API

```powershell
Set-Location 'G:\code\BTL_Cloud_2627I_INT3319_1\frontend'

$env:VITE_UPLOAD_MODE = 'api'
$env:VITE_API_BASE_URL = 'http://127.0.0.1:8000'

pnpm.cmd run dev --port 5173 --strictPort
```

Mở **http://127.0.0.1:5173**.

- Giao diện phải dùng chế độ API; nếu hộp chọn kết nối vẫn ở demo, chọn lại API với URL backend trên.
- Không dùng `/docs`, `/upload` hoặc `/files` làm URL gốc của backend.
- Nếu cổng 5173 đang bận, dừng đúng frontend cũ trước hoặc đồng bộ port và CORS nếu nhóm chủ động đổi port.
- Giữ terminal này mở.

## 8. Terminal 3 — kiểm health và Swagger

```powershell
Set-Location 'G:\code\BTL_Cloud_2627I_INT3319_1\backend'

Invoke-RestMethod 'http://127.0.0.1:8000/health' | Format-List
```

Cần thấy:

```text
status                  : ok
storage                 : s3
storage_configured      : True
metadata_mode           : dynamodb
metadata_configured     : True
scan_pipeline_enabled   : True
owner_mode              : development
```

`configured=true` chỉ xác nhận app có cấu hình/client; chưa chứng minh quyền AWS hoặc upload thành công. `scan_status` trên health là trạng thái khởi tạo, không phải kết quả một file.

Mở **http://127.0.0.1:8000/docs** để xem Swagger. Đường dẫn gốc **http://127.0.0.1:8000/** hiện trả `{"detail":"Not Found"}` vì chưa có route `/`; điều này không đồng nghĩa backend hỏng.

## 9. Upload một file sạch từ frontend và lấy ID

1. Trên frontend, mở **F12 → Network** và để ghi request.
2. Chọn file `demo-clean.txt` đã chuẩn bị ở phần 1, upload từ giao diện.
3. Trong Network, chọn request **POST /upload** tới `127.0.0.1:8000`.
4. Mở **Response** và ghi lại `id`, `key`, `storage`, `upload_state`.

Ví dụ minh họa, không dùng ID này cho lệnh kiểm tra:

```json
{
  "id": "abc-123",
  "key": "uploads/dev-user/abc-123/demo-clean.txt",
  "storage": "s3",
  "original_name": "demo-clean.txt",
  "size_bytes": 45,
  "content_type": "text/plain",
  "scan_status": "scanning",
  "upload_state": "uploaded"
}
```

Kết quả mong đợi:

- HTTP **201 Created**.
- `storage=s3`, `upload_state=uploaded`.
- `id` là file ID do backend tạo, chính là `file_id` trong DB.
- `key` là key object, không phải URL download.
- `scan_status` có thể còn `scanning` hoặc đã có kết quả cuối nếu Lambda chạy nhanh.

Cũng có thể mở chi tiết file trên UI, xem **ID máy chủ** và **Object key**. Không lấy ID tạm của hàng UI hoặc ID có tiền tố demo.

Terminal backend cần có dòng tương tự:

```text
POST /upload HTTP/1.1 ... 201 Created
```

HTTP 201 chưa chứng minh quét/cách ly/thông báo hoàn tất. Nếu upload trả 502/503, xem response headers **X-File-Id/X-File-Key** nếu có và kiểm AWS theo ID đó trước khi gửi lại; mỗi POST mới tạo ID mới.

## 10. Terminal 3 — đọc trạng thái thật qua API

Thay placeholder bằng ID vừa lấy:

```powershell
$fileId = 'DAN_ID_THAT_TU_RESPONSE'

Invoke-RestMethod "http://127.0.0.1:8000/files/$fileId/status" |
    ConvertTo-Json -Depth 10
```

Với file sạch, kết quả cuối cần tương tự:

```json
{
  "id": "ID_THAT_CUA_BAN",
  "scan_status": "safe",
  "upload_state": "uploaded",
  "findings_count": 0,
  "finding_types": [],
  "status_reason": null,
  "scanned_at": "THOI_GIAN_QUET",
  "quarantined_at": null,
  "updated_at": "THOI_GIAN_CAP_NHAT"
}
```

Đây là minh họa cấu trúc; thời gian thực tế là chuỗi có timezone, thường dạng UTC kết thúc `Z`.

Nếu còn `scanning`, đợi vài giây rồi **tự chạy lại lệnh trên**. Với file PII, `flagged` là trạng thái còn chờ cách ly, chưa hoàn tất. Nếu chờ vài phút chưa đổi, chuyển sang kiểm execution ở phần 13; không sửa DB thủ công để ép kết quả.

Có thể dùng Swagger: mở **GET /files/{file_id}/status → Try it out → nhập ID → Execute**. Đọc phần **Server response → Response body**, không đọc Example Value để kết luận kết quả thật.

Terminal backend sẽ có request GET trả **200 OK** nếu đọc thành công. HTTP 200 chưa thay thế việc kiểm giá trị `scan_status` trong response.

Để xem danh sách qua API, có thể chạy thêm:

```powershell
Invoke-RestMethod 'http://127.0.0.1:8000/files?limit=20' |
    ConvertTo-Json -Depth 10
```

Danh sách có phân trang, thứ tự hiện theo file_id, không bảo đảm file mới nhất ở trang đầu. Nếu chưa thấy file, dùng endpoint theo ID để đối chiếu chính xác.

## 11. AWS Console — đối chiếu S3

1. Vào **S3 → bucket upload thật → Objects**.
2. Tìm prefix/key đúng như `key` của response, ví dụ `uploads/dev-user/FILE_ID/`.
3. Mở object và đối chiếu tên, dung lượng, thời gian upload và version nếu có.

Với file sạch, object cần còn trong bucket upload theo thiết kế hiện tại. Với file PII đã cách ly, kiểm bucket quarantine và chính sách xóa nguồn ở phần 15.

Nếu muốn kiểm thêm bằng terminal 3, đặt lại bucket/region/key vì biến ở terminal 1 không tự truyền sang đây:

```powershell
$bucket = 'THAY_TEN_BUCKET_UPLOAD'
$s3Region = 'THAY_REGION_BUCKET'
$key = 'DAN_KEY_THAT_TU_RESPONSE'

aws s3api head-object --bucket $bucket --key $key --profile securedrive-key --region $s3Region --no-cli-pager
```

Đối chiếu `ContentLength`, `ContentType`, `LastModified`, `VersionId` nếu có. HeadObject chỉ đọc metadata, không so toàn bộ byte. Cần quyền `s3:GetObject`; 403 có thể do thiếu quyền hoặc không có object nhưng thiếu quyền ListBucket, nên không tự kết luận file bị mất từ riêng mã 403. [AWS HeadObject](https://docs.aws.amazon.com/cli/latest/reference/s3api/head-object.html).

### Tùy chọn: so nội dung file sạch bằng SHA256 thủ công

Nếu muốn xác nhận byte trên S3 đúng file đã upload, tải object sạch về đường dẫn mới và so hash. Thay đường dẫn nguồn bằng file bạn thực sự đã chọn ở frontend:

```powershell
$sourceFile = 'C:\THAY_DUONG_DAN_FILE_GOC\demo-clean.txt'
$downloadDir = Join-Path (Get-Location).Path '.test-tmp\manual-download'
New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null
$downloadedFile = Join-Path $downloadDir ('downloaded-' + [guid]::NewGuid().ToString() + '.txt')

aws s3 cp "s3://$bucket/$key" $downloadedFile --profile securedrive-key --region $s3Region
```

Chỉ khi lệnh tải thành công, chạy:

```powershell
Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256
Get-FileHash -LiteralPath $downloadedFile -Algorithm SHA256
```

Hai giá trị Hash cần giống nhau. Nếu source_version_id trong DB chỉ định một version cụ thể, đối chiếu đúng version qua Console hoặc dùng GetObject với --version-id; lệnh `s3 cp` trên lấy version hiện hành.

## 12. AWS Console — đối chiếu DynamoDB

Chọn **Sydney** cho các thao tác DB dưới đây.

### 12.1. Metadata trong securedrive-files

Vào **DynamoDB → Tables → securedrive-files → Explore table items**.

Chọn **Query**, table gốc securedrive-files:

```text
Partition key: owner_id
Value: dev-user

Sort key: file_id
Condition: Equal to
Value: FILE_ID_THAT
```

Bấm **Run**, mở item tìm được:

| Trường | Kết quả ca sạch |
|---|---|
| owner_id | dev-user |
| file_id | Bằng id từ POST /upload |
| original_name | Tên file đã chọn |
| storage | s3 |
| upload_bucket | Bucket upload đúng |
| key | Bằng key từ response |
| size_bytes | Đúng dung lượng nguồn |
| upload_state | uploaded |
| status | safe khi Scan xong |
| findings_count | Number 0 |
| finding_types | List rỗng |
| scanned_at | Có thời gian hoàn tất Scan |
| created_at / updated_at | Có thời gian hợp lệ |

DB dùng **status**, API trả tên **scan_status**. `upload_state=uploaded` và `findings_count=0` lúc mới khởi tạo chưa chứng minh file sạch; phải xem status kết quả.

### 12.2. Lịch sử trong securedrive-audit-log

Vào **securedrive-audit-log → Explore table items → Query**:

```text
Partition key: file_id
Value: FILE_ID_THAT

Sort key: event_key
Để trống điều kiện/giá trị
```

Bấm **Run**, xem các sự kiện:

| Giai đoạn | Action theo hợp đồng hiện có |
|---|---|
| Bắt đầu upload | upload_started |
| Upload xong | upload_completed |
| Scan sạch | scan_safe |
| Thông báo sạch nếu đã nối | notify_safe |

Các tên action Scan/Quarantine cần khớp tên nhóm đã chốt; không coi một action upload là bằng chứng Scan. Mỗi event cần đúng file_id, owner_id, event_key, action, actor và thời gian. event_key dạng `occurred_at#event_id`.

Lambda có thể chạy xong trước khi HTTP upload trả về, nên audit Scan có thể xen trước upload_completed; không yêu cầu toàn bộ event phải có thứ tự giai đoạn tuyệt đối. Nếu có nhiều trang, xem tiếp đến hết các sự kiện của file.

Không cần nhập item nghiệp vụ bằng tay hoặc Scan toàn bảng để tìm đúng file. Bảng securedrive-users có thể vẫn chưa có item vì auth chưa được tích hợp.

## 13. AWS Console — kiểm Step Functions và log Lambda

1. Chọn region nơi pipeline thực sự triển khai.
2. Vào **Step Functions → State machines → state machine của nhóm → Executions**.
3. Mở execution theo thời điểm upload, đối chiếu **Input có đúng bucket/key** của file. Nếu metadata có execution_id, dùng thêm để xác nhận.
4. Xem Graph/Table và Input/Output của từng bước đã chạy.

Với file sạch cần:

- Scan nhận đúng file nguồn, trả kết quả sạch.
- Đi nhánh safe.
- Notify chạy nếu đã nối chức năng này.
- Kết thúc phù hợp, thông thường execution SUCCEEDED.
- Các bước sau Scan vẫn có context đủ để cập nhật đúng file.

Execution màu xanh chưa tự chứng minh nghiệp vụ thành công: một hàm có thể trả JSON status=error mà task vẫn hoàn thành. Xem output nghiệp vụ và DB cùng lúc. AWS Console hỗ trợ xem trạng thái và input/output từng bước; Express workflow cần log phù hợp để tra lịch sử. [AWS execution details](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-view-execution-details.html).

Nếu không thấy execution mới:

- Xác nhận đúng account, region, state machine và khoảng thời gian.
- Xác nhận object đã vào đúng bucket/prefix.
- Nhờ bên AWS kiểm EventBridge rule/target và quyền khởi chạy workflow nếu bạn không được cấp quyền xem.
- Không bấm Start execution thêm để thay cho bằng chứng trigger tự chạy của lần upload này.

Nếu execution lỗi hoặc DB không đổi:

1. Mở bước lỗi → xem Error/Cause và Input/Output.
2. Vào **Lambda → hàm liên quan → Monitor → View CloudWatch logs**.
3. Tìm theo thời gian, request/execution ID và file ID khi hàm có log các trường đó.
4. Kiểm lỗi AccessDenied, ValidationException, ResourceNotFoundException, timeout hoặc lỗi xử lý nội dung.
5. Đối chiếu role Lambda, tên bảng, đủ hai khóa files và event_key audit.

Không kết luận thiếu log chứa file ID là hàm chưa chạy nếu source chưa ghi trường đó; dùng execution/request ID để truy vết.

## 14. Kiểm Notify/SNS nếu nằm trong phạm vi triển khai

- Output bước Notify đúng file và loại thông báo.
- Audit có notify_safe hoặc action tương ứng đã thống nhất.
- Nếu có sns_message_id, đây là bằng chứng publish được chấp nhận, chưa chứng minh email đã đến hộp thư.
- Kiểm subscription đã xác nhận, đúng email và kiểm Inbox/Spam.
- Notify lỗi phải giữ kết quả file safe/quarantined, không biến file sạch thành lỗi quét.

Nếu hiện nhóm chưa nối Notify với DB/email, ghi rõ phần này chưa hoàn tất, không đánh dấu toàn bộ luồng thông báo đã đạt.

## 15. Sau ca sạch — kiểm thủ công file PII giả

Tạo file .txt khác bằng Notepad, dùng dữ liệu giả theo mẫu scanner nhóm hỗ trợ, ví dụ:

```text
Synthetic test only. CREDIT_CARD: 4111 1111 1111 1111
```

Mẫu trên khớp regex CREDIT_CARD trong repo; bên Scan cần xác nhận bản AWS cũng nhận mẫu và loại file này. Không dùng thông tin cá nhân/thẻ thật.

1. Upload file PII giả từ frontend.
2. Lấy **ID mới và key mới** từ response; thay `$fileId`, `$key` ở terminal 3.
3. Tự gọi lại GET status như phần 10.
4. Kiểm item files/audit và execution đúng ID mới.
5. Kiểm bucket quarantine, copy/xóa nguồn và thông báo.

| Điểm | Kết quả cần thấy |
|---|---|
| Scan | Có phát hiện, findings_count > 0 và finding_types đúng |
| Trạng thái đang xử lý | scanning hoặc flagged |
| Cách ly xong | quarantined, có quarantined_at và vị trí bản cách ly |
| Object đích | Có trong bucket quarantine theo metadata |
| Nguồn | Được xử lý theo chính sách nhóm; nếu bật versioning, kiểm các version/delete marker liên quan |
| Audit | Có phát hiện, cách ly và thông báo tương ứng |
| API | Trả cùng kết quả cuối với DB |

Nguồn 404 không chứng minh đã xóa hết version cũ. `quarantine_delete_failed` nghĩa là chưa hoàn tất việc xóa nguồn, không đánh dấu cách ly thành công chỉ vì đã có bản copy.

Các ca lỗi có thể đối chiếu thêm cùng bên AWS:

| Ca | Kết quả |
|---|---|
| Chưa hỗ trợ định dạng | unscanned và có lý do |
| Scan thất bại | error và audit lỗi, không kẹt scanning |
| Copy cách ly thất bại | error và chi tiết/audit lỗi |
| Copy được, xóa nguồn lỗi | quarantine_delete_failed, giữ vị trí bản copy |
| Notify thất bại | Trạng thái file giữ nguyên, audit thông báo lỗi |
| Cùng event chạy lại | Không lặp sự kiện logic, không lùi trạng thái |

Phối hợp bên AWS để tái hiện lỗi/replay trong phạm vi test của nhóm. Không xóa tài nguyên hoặc thu hồi quyền dùng chung chỉ để gây lỗi. Upload lại file từ frontend tạo ID mới, không phải phép thử retry cùng event.

## 16. Nếu muốn lưu cấu hình thay vì nhập lại mỗi lần

Đây là lựa chọn thay thế cách đặt biến terminal ở trên. Chỉ sửa các dòng tương ứng trong file đang có, không ghi đè toàn bộ .env của nhóm và không để một biến có nhiều giá trị trùng tên.

Trong backend/.env:

```dotenv
AWS_PROFILE=securedrive-key
MAYSEC_STORAGE_MODE=s3
MAYSEC_METADATA_MODE=dynamodb
MAYSEC_SCAN_PIPELINE_ENABLED=true
S3_BUCKET_NAME=THAY_TEN_BUCKET_UPLOAD
AWS_REGION=THAY_REGION_BUCKET
DYNAMODB_REGION=ap-southeast-2
DYNAMODB_FILES_TABLE=securedrive-files
DYNAMODB_AUDIT_TABLE=securedrive-audit-log
DYNAMODB_USERS_TABLE=securedrive-users
MAYSEC_CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

Từ backend/, chạy:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --env-file .env
```

Trong frontend/.env.local:

```dotenv
VITE_UPLOAD_MODE=api
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_MAX_FILE_SIZE_MB=100
```

Vite tự đọc .env.local. File .env.example chỉ là mẫu, không tự được nạp. Biến môi trường đã đặt trong terminal ưu tiên hơn file cấu hình; đổi cấu hình cần restart đúng process.

## 17. Bảng xử lý nhanh khi kết quả không đúng

| Hiện tượng | Kiểm tra tiếp |
|---|---|
| Frontend không có POST /upload | Demo mode, URL API hoặc cấu hình kết nối cũ |
| Health vẫn local/disabled/false | Process cũ hoặc env terminal đang ghi đè file |
| POST 201 nhưng storage=local | Chưa chuyển backend sang s3 |
| POST 502/503 | Response headers ID/key, log backend, quyền S3/DB; kiểm object trước khi gửi lại |
| CORS/preflight lỗi | Đúng protocol/hostname/port 5173 và MAYSEC_CORS_ORIGINS |
| API gốc / trả 404 | Dùng /health hoặc /docs; route / chưa có |
| GET status 404 | ID sai, item chưa có hoặc owner khác; hiện backend dùng dev-user |
| not_started | Đang xem file cũ/local hoặc lần upload chưa bật cấu hình pipeline |
| scanning lâu | Trigger, execution, writer DB, IAM và nhánh lỗi Scan |
| flagged lâu | Nhánh Quarantine, copy/xóa và nơi ghi trạng thái cuối |
| DB safe nhưng API lỗi/summary thiếu | Kiểu/trường metadata, scanned_at, schema và log backend |
| Audit chỉ có upload | Writer audit Lambda, tên action hoặc quyền của role Lambda |
| S3 HeadObject 403 | Quyền đọc object/bucket, account và key; không tự kết luận object không tồn tại |
| Có object nhưng không có execution | Sai bucket/prefix/region hoặc EventBridge rule/target/quyền |
| Execution xanh nhưng DB chưa đúng | Output nghiệp vụ, lỗi DB bị nuốt hoặc writer đang ghi sai item/bảng |
| Không xem được Step Functions/logs | Quyền Console riêng; nhờ bên AWS tra đúng ID/key |
| Refresh UI mất danh sách/kết quả không tự đổi | React hiện chưa nối tải lại GET /files và polling; kiểm bằng API/DB |

## 18. Checklist hoàn tất và bằng chứng

Với **một lần upload file sạch**, đối chiếu cùng ID/key:

- [ ] Frontend dùng API thật, POST trả 201 và storage=s3.
- [ ] S3 có object đúng key, dung lượng đúng; hash giống nguồn nếu đã so byte.
- [ ] Metadata đúng owner/file/bucket/key, upload_state=uploaded.
- [ ] Scan kết thúc safe, có summary và thời gian phù hợp.
- [ ] API status đọc được kết quả khớp DB.
- [ ] Audit có upload và Scan theo hợp đồng nhóm.
- [ ] Execution đúng bucket/key, đi đúng nhánh và hoàn tất.
- [ ] Notify/audit/email đã kiểm, hoặc ghi rõ chưa thuộc phần hoàn tất.

Với file PII, bổ sung bản cách ly, xử lý nguồn/version, trạng thái cuối và audit.

Mẫu ghi lại cho mỗi ca:

```text
Ngày/giờ:
Tên file:
Owner ID:
File ID:
Bucket / region:
Object key:
Upload HTTP / storage:
Trạng thái cuối API / DB:
Execution ID / ARN:
Audit actions:
Quarantine / xử lý nguồn (nếu có):
Notify / email:
Kết luận và phần chưa kiểm:
```

Các bước này xác minh tích hợp đang có, chưa nghiệm thu đăng nhập/phân quyền user/admin. Script kiểm thử không được gọi trong hướng dẫn này. Dữ liệu upload vẫn là dữ liệu thật trên tài khoản AWS của nhóm; dọn đúng file test theo quy trình nhóm khi đã lưu bằng chứng, không xóa bảng/bucket dùng chung.

## 19. Tài liệu liên quan

- [Schema item DynamoDB](dynamodb-item-schema.md).
- [Hợp đồng API](api-contract.md).
- [Cấu hình backend mẫu](../backend/.env.example).
- [Cấu hình frontend mẫu](../frontend/.env.example).
- [AWS HeadObject](https://docs.aws.amazon.com/cli/latest/reference/s3api/head-object.html).
- [AWS Step Functions execution details](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-view-execution-details.html).

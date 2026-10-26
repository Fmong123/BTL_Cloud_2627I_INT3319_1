# Schema item DynamoDB cho MaySec / SecureDrive

Cập nhật: **23/10/2026**, bổ sung tương thích bàn giao AWS mới.

Project chính: `G:\code\BTL_Cloud_2627I_INT3319_1`.

Tài liệu tổng hợp thông tin mỗi item dựa trên báo cáo thiết kế, hai tài liệu bàn giao AWS và các repository hiện có. Đây là hợp đồng đề xuất để backend và bên AWS thống nhất; không phải toàn bộ tính năng đã được triển khai hoặc nghiệm thu.

## 1. Nguồn và quy ước chung

Nguồn đối chiếu:

- Báo cáo thiết kế: `Báo cáo tiến độ 1_Nhóm 4 _INT3319_1.pdf`.
- Hiện trạng AWS: `hand_off_Bang.pdf`.
- Bản mới: `hand_off_Bang (1).pdf`, đã làm rõ Scan ghi DB, trạng thái và khóa mặc định khác các bảng hiện có.
- Bàn giao phần ghi DB: `HANDOFF_DB.pdf`.
- [Bản đối chiếu bàn giao và thiết kế](<G:/code/GPT cloud/DOI_CHIEU_BAN_GIAO_AWS_VA_THIET_KE_DYNAMODB.md>).
- [FileMetadataRepository](../backend/app/services/file_metadata.py), [AuditLogRepository](../backend/app/services/audit_log.py).
- [Hướng dẫn test repository](dynamodb-service-test-guide.md).

Phân biệt ba mức:

1. **DynamoDB bắt buộc có các trường khóa** để nhận diện item.
2. **Ứng dụng cần các trường nghiệp vụ** để hiển thị và xử lý đúng.
3. Các trường kết quả chỉ được bổ sung sau bước xử lý tương ứng; không cần điền tất cả ngay khi upload.

`HANDOFF_DB.pdf` chưa chốt đầy đủ khóa và schema vật lý. Các khóa dưới đây khớp ba bảng người dùng đã tạo; chi tiết nghiệp vụ cần thống nhất với người phụ trách Lambda/Step Functions trước khi tích hợp.

| Bảng | Partition key | Sort key | Một item đại diện cho |
|---|---|---|---|
| `securedrive-files` | `owner_id` — String | `file_id` — String | Một file upload |
| `securedrive-audit-log` | `file_id` — String | `event_key` — String | Một sự kiện xử lý file |
| `securedrive-users` | `user_id` — String | Không có | Một người dùng ứng dụng |

Region DynamoDB của nhóm: **Asia Pacific (Sydney), `ap-southeast-2`**. Tên bảng bắt đầu bằng **`securedrive-`**. Region S3 phải kiểm tra riêng.

Các thuộc tính ngoài khóa được thêm khi ghi item, không phải tạo từng cột trên Console như SQL. Dùng dung lượng byte nguyên, thời gian UTC chuẩn hóa dạng `2026-10-21T13:00:00.000Z`. Chuẩn hóa output Lambda có offset hoặc độ chính xác khác trước khi dùng làm khóa sắp xếp.

## 2. Item trong securedrive-files

Một item đại diện cho một file được upload. Backend tạo metadata trước khi ghi nội dung file lên S3; pipeline cập nhật kết quả sau đó.

### 2.1. Các trường ban đầu

| Trường | Kiểu DynamoDB | Mức cần thiết / nội dung |
|---|---|---|
| `owner_id` | String | Partition key; ID chủ sở hữu, lấy từ danh tính được backend xác thực |
| `file_id` | String | Sort key; UUID do backend sinh một lần, dùng chung toàn luồng |
| `original_name` | String | Tên gốc, ví dụ `ho-so.csv` |
| `key` | String | Key upload ban đầu: `uploads/{owner_id}/{file_id}/{safe_filename}` |
| `size_bytes` | Number | Dung lượng byte, số nguyên dương theo validation hiện tại |
| `content_type` | String | MIME client khai báo, ví dụ `text/csv`; chưa phải kết quả xác minh nội dung |
| `storage` | String | `local` hoặc `s3` |
| `upload_bucket` | String | Cần khi storage=s3; không ghi cho local |
| `upload_state` | String | Tình trạng ghi nội dung; khởi tạo `uploading` |
| `status` | String | Trạng thái xử lý/quét công khai |
| `findings_count` | Number | Số phát hiện; khởi tạo `0` |
| `finding_types` | List các String | Loại PII; khởi tạo `[]`, ví dụ sau Scan là `["CREDIT_CARD"]` |
| `created_at` | String | Thời gian tạo metadata, UTC |
| `updated_at` | String | Thời gian cập nhật gần nhất, UTC |
| `created_order` | String | `created_at#file_id`; chuẩn bị cho index theo thời gian tạo |
| `status_time` | String | Mốc thời gian trạng thái kết hợp `#file_id`; chuẩn bị cho index trạng thái |

Những trường cần nhập cho `create_upload_record()` hiện tại là owner_id, file_id, original_name, key, size_bytes, content_type, storage và upload_bucket nếu dùng S3. Service tự tạo upload_state, status, findings_count, finding_types, timestamp và các trường sắp xếp. Caller có thể truyền created_at để giữ mốc xác định.

`created_order` và `status_time` đã được code tạo sẵn; index tương ứng chưa tự được tạo. `status_time` được khởi tạo theo created_at và cần cập nhật khi trạng thái quét đổi. Phương thức cập nhật upload hiện tại chỉ sửa upload_state/updated_at, không sửa status_time hoặc kết quả Scan.

### 2.2. Tách trạng thái upload và quét

| Trường | Giá trị | Ý nghĩa |
|---|---|---|
| `upload_state` | `uploading` | Đang ghi nội dung |
| `upload_state` | `uploaded` | Storage đã xác nhận ghi |
| `upload_state` | `failed` | Ghi nội dung thất bại đã xác định |
| `upload_state` | `unknown` | Chưa chắc thao tác ghi đã thành công hay chưa, ví dụ timeout |
| `status` | `not_started` | Chế độ local/chưa nối pipeline, chưa quét |
| `status` | `scanning` | Đang chờ hoặc đang xử lý trong pipeline |
| `status` | `safe` | Quét thành công và không phát hiện PII |
| `status` | `flagged` | Đã phát hiện PII; đang chờ/thực hiện cách ly |
| `status` | `quarantined` | Hoàn tất quy trình cách ly bắt buộc |
| `status` | `quarantine_delete_failed` | Có bản copy cách ly, chưa xóa được nguồn; cần xử lý |
| `status` | `unscanned` | Chưa hỗ trợ kiểm tra loại file |
| `status` | `error` | Lỗi đọc/xử lý/cách ly, kèm lý do |

`upload_state=uploaded` không chứng minh file an toàn. `findings_count=0` lúc khởi tạo cũng chưa phải kết quả Scan. `flagged` là kết quả phát hiện của scanner; chưa đồng nghĩa cách ly hoàn tất.

Service chỉ khởi tạo scanning khi caller truyền pipeline_enabled=True cùng storage=s3. FastAPI lấy từ MAYSEC_SCAN_PIPELINE_ENABLED (mặc định false), yêu cầu storage=s3 và metadata=dynamodb. Chỉ bật sau khi pipeline AWS được xác nhận; local dùng not_started. API nhận flagged và quarantine_delete_failed trực tiếp, không đổi sang scanning/error như đề xuất cũ.

### 2.3. Trường bổ sung theo bước xử lý

| Khi nào | Trường | Kiểu / nội dung |
|---|---|---|
| Workflow bắt đầu | `execution_id` | String; định danh lượt chạy Step Functions |
| S3 nguồn bật versioning | `source_version_id` | String; version nguồn đang xử lý |
| Scan có kết quả | `scan_result` | Bản bàn giao mới dùng Map chứa findings/finding_counts; API không trả Map này. Writer cần chốt cấu trúc và ưu tiên cập nhật summary top-level. String từ code cũ vẫn có thể tồn tại nhưng không được dùng để suy ra status |
| Scan hoàn tất | `scanned_at` | String UTC |
| Có kết quả phát hiện | `findings_count`, `finding_types` | Cập nhật Number và List các String |
| Unsupported hoặc lỗi | `status_reason` | String mã lý do, ví dụ unsupported_type |
| Đang/đã cách ly | `quarantine_status` | String: pending, completed, copy_failed, delete_failed theo contract đề xuất |
| Có bản cách ly | `quarantine_bucket` | String; bucket đích |
| Có bản cách ly | `quarantine_key` | String; key đích |
| S3 đích bật versioning | `quarantine_version_id` | String; version đích |
| Dùng KMS khi cách ly | `kms_key` | String; ARN/định danh KMS, không phải vật liệu khóa bí mật |
| Cách ly hoàn tất | `quarantined_at` | String UTC |

Giữ key nguồn và bổ sung quarantine_key, không ghi đè mất dấu vị trí ban đầu. Trường chưa có kết quả có thể chưa ghi vào item.

Theo bàn giao mới, dùng **findings_count/finding_types**, thay cho finding_count/detected_types trong đề xuất cũ.

### 2.4. Mapping kết quả pipeline cần chốt

| Tình huống | status | Thông tin đi kèm |
|---|---|---|
| Scan safe | safe | findings_count=0, finding_types=[] |
| Scan flagged, chưa cách ly xong | flagged | quarantine_status=pending, summary phát hiện |
| Cách ly hoàn tất | quarantined | quarantine_status=completed, vị trí và thời gian |
| Loại file chưa hỗ trợ | unscanned | status_reason=unsupported_type |
| Lỗi đọc/quét | error | lý do đã lọc |
| Copy cách ly lỗi | error | quarantine_status=copy_failed |
| Copy xong, xóa nguồn lỗi | quarantine_delete_failed | quarantine_status=delete_failed, status_reason=quarantine_delete_failed |
| Gửi thông báo lỗi | Giữ safe/quarantined | Ghi audit notify_failed |

Theo bàn giao mới, nhánh RecordNotScanned do Scan lỗi/timeout cần ghi error; file unsupported chủ động trả unscanned. Nhánh QuarantineFailed cần ghi lỗi cuối cùng, không để flagged vô hạn và không ghi đè quarantine_delete_failed đã biết. API content sau này phải chặn file flagged/lỗi cách ly dù nguồn còn tồn tại. Poll cả scanning và flagged.

### 2.5. Tương thích đầu ra Scan trong API

- Canonical: status_reason, findings_count (Number nguyên >=0), finding_types (List String), scanned_at/quarantined_at (String có timezone).
- Alias đọc: reason -> status_reason khi canonical trống. Timestamp kết quả được chuẩn hóa UTC milliseconds; timestamp không có timezone bị từ chối.
- Nếu summary top-level thiếu hoặc còn giá trị khởi tạo 0/[], API có thể tổng hợp từ scan_result.findings (List Map có type) và finding_counts (Map loại -> Number nguyên >=0). Tổng count lấy từ Map counts nếu có, nếu không lấy số findings; loại lấy từ findings hoặc khóa counts có giá trị >0. Loại từ alias phải là mã chữ hoa/số/underscore, không phải giá trị PII. Nếu Lambda dùng kiểu finding_counts khác thì phải chốt adapter trước.
- Summary canonical có giá trị nonzero/nonempty được ưu tiên. Lambda nên cập nhật cùng lúc canonical summary và scan_result để không giữ hai kết quả mâu thuẫn; API không chứng minh tính đúng của kết quả quét.
- List/status chỉ trả summary, lý do và thời gian; không trả findings/location, scan_result, quarantine_bucket/key hoặc kms_key. Item thiếu trường metadata bắt buộc vẫn trả 503, không tự sửa DB.
- Bảng files có khóa ghép: mọi Lambda UpdateItem/GetItem phải dùng cả owner_id và file_id. Đổi FILES_TABLE/FILES_PK không tự sửa code khóa. Audit phải ghi file_id+event_key; log_id từ Scan chỉ có thể dùng làm event_id để tạo khóa ổn định, không thay thế event_key.

### 2.6. Mapping sang API và frontend

| DB | API | Frontend |
|---|---|---|
| `file_id` | `id` | `remoteId` |
| `status` | `scan_status` | `scanStatus` |
| `original_name` | `original_name` | `name` |
| `size_bytes` | `size_bytes` | `size` |
| `content_type` | `content_type` | `type` |
| `key` | `key` | `key` |
| `storage` | `storage` | `storage` |
| `created_at` | `created_at` | `createdAt` sau khi parse |

State queued/uploading/success/error/cancelled trên frontend mô tả upload, tách biệt với scanStatus.

## 3. Item trong securedrive-audit-log

Một item đại diện cho một sự kiện. Một file có nhiều sự kiện: upload, Scan, cách ly, thông báo. Ghi sự kiện mới thay vì sửa lịch sử cũ.

### 3.1. Các thuộc tính

| Trường | Kiểu DynamoDB | Mức cần thiết / nội dung |
|---|---|---|
| `file_id` | String | Partition key; trùng ID file trong files |
| `event_key` | String | Sort key; dạng occurred_at#event_id |
| `owner_id` | String | Chủ sở hữu file |
| `action` | String | Hành động đã xảy ra |
| `actor` | String | Thành phần thực hiện, ví dụ securedrive-notify |
| `occurred_at` | String | Thời điểm sự kiện, UTC |
| `details` | Map | Chi tiết đã lọc; service tạo {} nếu không truyền |
| `execution_id` | String | Bổ sung cho sự kiện thuộc workflow |
| `from_status` | String | Bổ sung khi cần ghi trạng thái trước |
| `to_status` | String | Bổ sung khi cần ghi trạng thái sau |

`write_event()` nhận bắt buộc owner_id, file_id, event_id, occurred_at, action, actor và tự tạo event_key. Hiện event_id không được lưu thành thuộc tính riêng, mà nằm trong event_key.

### 3.2. Action

| Nhóm | Action |
|---|---|
| Upload | upload_started, upload_completed, upload_failed |
| Scan | scan_safe, scan_flagged, scan_unscanned, scan_error |
| Quarantine | quarantine_completed, quarantine_failed, quarantine_delete_failed |
| Notify | notify_safe, notify_quarantined, notify_failed |

notify_safe và notify_quarantined giữ đúng HANDOFF_DB. Các action khác là đề xuất cần thống nhất. Repository hiện nhận action là chuỗi không rỗng, chưa áp enum nghiệp vụ.

### 3.3. Nội dung details theo sự kiện

| Sự kiện | Thông tin cần ghi |
|---|---|
| Scan | findings_count, finding_types; lý do nếu không quét được |
| Quarantine | quarantine_bucket, quarantine_key, kms_key, findings_count, finding_types, quarantined_at; nguồn/version khi có |
| Notify | sns_message_id; kết quả hoặc tên kênh webhook đã lọc |
| Lỗi | Mã lỗi và lý do đã lọc để đối chiếu |

Tên và kiểu webhook cần chốt với bên AWS; không lưu URL webhook chứa secret. SNS trả message ID chỉ xác nhận Publish được chấp nhận, chưa chứng minh email đã đến hộp thư.

### 3.4. Retry và tính bất biến

- Cùng một sự kiện: giữ nguyên event_id, occurred_at và payload.
- Retry giống hệt: service trả False, không tạo thêm item.
- Cùng event_key nhưng khác nội dung: báo DynamoDBConflict, giữ sự kiện cũ.
- Có hành động mới: event ID mới, ghi item mới.
- Service không cung cấp phương thức sửa/xóa audit nghiệp vụ.
- Caller phải kiểm tra quyền xem file trước khi Query lịch sử; repository chưa làm xác thực người gọi.

## 4. Item trong securedrive-users

Một item đại diện cho một người dùng ứng dụng.

| Trường | Kiểu DynamoDB | Nội dung |
|---|---|---|
| `user_id` | String | Partition key; ID ổn định từ hệ thống đăng nhập |
| `name` | String | Tên hiển thị |
| `email` | String | Email |
| `role` | String | user hoặc admin |
| `active` | Boolean | Tài khoản ứng dụng còn được phép sử dụng hay không |
| `created_at` | String | Thời gian tạo, UTC |
| `updated_at` | String | Thời gian cập nhật, UTC |

Quan hệ: **users.user_id = files.owner_id**.

Đây là hồ sơ và vai trò của người dùng ứng dụng, không phải IAM user dùng đăng nhập AWS Console. Backend cần cơ chế xác thực token/session; không tin role do client tự khai. Không lưu mật khẩu plaintext, access key hoặc session token vào item.

Service users và chức năng đăng nhập hiện chưa được thêm. Chi tiết nguồn user_id/role cần thống nhất khi chọn cơ chế xác thực.

## 5. Dữ liệu test và dữ liệu nghiệp vụ

Các thuộc tính/giá trị sau dùng nhận diện dữ liệu thử:

```text
record_type = smoke_test
test_note   = updated_from_python
action      = db_smoke_test
```

- record_type/test_note không phải trường bắt buộc của metadata file thật.
- db_smoke_test là action thử, không chứng minh đã upload/quét/cách ly một file thật.
- Các item smoke test tạo thủ công chỉ có vài trường vẫn hợp lệ ở DynamoDB nếu đủ khóa, nhưng chưa phải metadata đầy đủ để ứng dụng xử lý.
- Script check_dynamodb.py dùng metadata tổng hợp với owner db-smoke-test và file ID repo-test-UUID; nó không ghi nội dung file lên local/S3.

## 6. Phạm vi đã có trong code và phần còn lại

| Phần | Hiện trạng |
|---|---|
| Client DB, serialization, lỗi, UTC và phân trang | Đã có trong db.py |
| Metadata ban đầu | create_upload_record() đã tạo các trường phần 2.1 |
| Cập nhật upload | Chỉ sửa upload_state/updated_at, bảo toàn kết quả Scan |
| Upload chắc chắn thất bại trong pipeline | mark_pending_scan_failed() chỉ đổi scanning -> error khi upload_state=failed; conditional, không đè kết quả Scan. Timeout/unknown cần đối soát |
| Đọc file/list theo owner | Đã có, list theo file_id; chưa có GSI theo thời gian |
| Audit mới/retry/lịch sử | Đã có trong AuditLogRepository |
| Ghi Scan/Quarantine | API đã đọc trạng thái/summary bàn giao; writer bên Lambda và nhánh lỗi workflow vẫn cần ghép đúng schema/IAM |
| Users/auth/admin | Chưa có service hoặc xác thực tương ứng |
| FastAPI upload/list/status | Đã ghép theo metadata mode; owner cố định dev-user, chưa có auth |
| FastAPI history/admin và React list/polling | Chưa ghép |
| Transaction metadata + audit | Chưa có; hiện là hai thao tác độc lập |

Tài liệu schema không tự thêm index, tạo dữ liệu hay sửa Lambda. Khi tích hợp, giữ đủ hai khóa files và truyền chung file_id từ backend xuyên suốt workflow.

## 7. Nguyên tắc lưu dữ liệu

- Nội dung file vẫn ở storage/S3; DB lưu metadata, trạng thái và tóm tắt.
- Không lưu toàn bộ OCR text, dữ liệu PII nguyên bản hoặc danh sách findings không giới hạn trong item. Kết quả lớn có thể tham chiếu tới S3 với kiểm soát quyền.
- Mỗi item chịu giới hạn 400 KB của DynamoDB; xem [giới hạn AWS](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html).
- Dùng Number cho size_bytes/findings_count, List cho finding_types, Map cho details và Boolean cho active; không biến tất cả thành chuỗi trên Console.
- Xóa metadata không tự xóa object S3 hoặc audit. Cần thiết kế luồng xóa riêng khi bổ sung chức năng đó.
- Giữ một bộ tên trường chuẩn giữa backend/Lambda/API; mapping rõ ràng khi output bàn giao có tên khác.

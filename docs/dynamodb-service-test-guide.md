> **Tài liệu tham chiếu lịch sử.** Các mốc tính năng, giới hạn và lệnh script/test bên dưới thuộc bản trước. Cài/chạy theo [API guide hiện hành](api-guide.md), endpoint theo [API contract](api-contract.md), triển khai AWS theo [handoff](AWS-HANDOFF-QUICKSTART-2026-10-31.md). Không cần khôi phục script/test cũ.

# Test lớp DynamoDB độc lập

Cập nhật ngày 21/10/2026. Chạy trong project chính `G:\code\BTL_Cloud_2627I_INT3319_1`.

## 1. Đã thêm gì và phạm vi

| File | Chức năng |
|---|---|
| `backend/app/db.py` | Factory low-level client, timeout/retry, serializer, lỗi DB, UTC và phân trang |
| `backend/app/services/file_metadata.py` | Conditional create, đọc theo hai khóa, cập nhật upload và Query theo owner |
| `backend/app/services/audit_log.py` | Ghi audit bất biến, chống retry trùng, Query lịch sử |
| `backend/tests/test_dynamodb.py` | Test offline bằng Stubber/client giả, không cần credentials thật |
| `backend/scripts/check_dynamodb.py` | Smoke test opt-in trên AWS thật bằng hai repository |

Các module repository không tạo client hoặc gọi AWS lúc import. FastAPI nay đã ghép metadata/audit khi bật cấu hình và có GET /files, GET /files/{id}/status. Frontend/history/auth/pipeline chưa ghép. Tài liệu này test repository riêng; test HTTP theo [hướng dẫn API local](dynamodb-fastapi-local-test-guide.md).

`build_dynamodb_client(settings)` trả `None` khi metadata disabled. Khi bật, client dùng region DB từ Settings và credential chain của Boto3; core service không hardcode key/profile. Caller sở hữu client được tạo và phải gọi `close()` khi xong. Repository nhận client đã có, không tự đóng client đó.

## 2. Chuẩn bị

Mở PowerShell:

```powershell
Set-Location 'G:\code\BTL_Cloud_2627I_INT3319_1\backend'
```

Nếu chưa có dependencies trong venv:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
```

Đã có boto3, python-dotenv và pytest trong requirements; không cần dependency mới. Rule loại `backend/tests/` khỏi Git đã bỏ để bộ test mới được bàn giao cùng source. Cache, venv, .env và dữ liệu upload vẫn bị bỏ qua.

## 3. Test offline trước

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_dynamodb.py -q
```

Đọc số test passed thực tế ở cuối. Test này dùng credentials giả và Stubber/client giả, không gọi AWS thật hoặc ghi S3.

Các nhóm kiểm tra:

- Metadata disabled không tạo AWS client; region DB độc lập S3, timeout/retry hữu hạn.
- Đúng serialization, byte/count nguyên, UTC và schema API đã thống nhất.
- Metadata đủ owner_id + file_id, key khớp owner/file; conditional create không ghi đè.
- Không khởi tạo scanning trên storage local; S3 phải có bucket khi tạo metadata.
- Update upload chỉ sửa upload_state/updated_at; không sửa status/scan_result dù Scan đã hoàn tất.
- Update item thiếu hoặc chuyển upload không hợp lệ báo conflict, tránh tạo item dở.
- Query phân trang đúng partition, trả next_key ngay cả trang items rỗng.
- Audit retry cùng event ID, occurred_at và payload trả False; không ghi thêm item.
- Audit cùng khóa nhưng nội dung khác báo conflict, không sửa lịch sử.
- AccessDenied báo lỗi thay vì trả []; timeout ghi được đánh dấu kết quả chưa chắc chắn.
- Smoke test từ chối account sai trước khi tạo client DB; toàn bộ flow script được test bằng stub.
- Factory FastAPI khi metadata disabled vẫn không tạo client DB; khi enabled khởi tạo ở lifespan.

Đây là kiểm tra lớp DB và script, chưa thay thế test HTTP/UI/Lambda hay toàn bộ API hiện có.

## 4. Test hai repository trên AWS thật

Chỉ chuyển bước này sau khi offline pass. `.env` cần:

```dotenv
MAYSEC_METADATA_MODE=dynamodb
DYNAMODB_REGION=ap-southeast-2
DYNAMODB_FILES_TABLE=securedrive-files
DYNAMODB_AUDIT_TABLE=securedrive-audit-log
DYNAMODB_USERS_TABLE=securedrive-users
```

Script tự nạp `.env` từ backend; biến đã có trong terminal được ưu tiên. Profile AWS đã cấu hình trên máy; không đặt key trong source/.env/frontend. Nếu dùng credentials tạm thời, bảo đảm cả Session Token còn hiệu lực. Dùng key hiện hành đã thay cho key từng lộ trong ảnh.

Chạy với account nhóm đã được cung cấp:

```powershell
.\.venv\Scripts\python.exe scripts/check_dynamodb.py `
    --aws `
    --profile securedrive-key `
    --expected-account '018913575473'
```

Đối chiếu account ID với AWS Console của nhóm trước khi chạy. `--aws` là lựa chọn cho phép script ghi dữ liệu thử thật. `--expected-account` được so với STS trước mọi thao tác DB. Có thể dùng `--env-file` nếu bạn quản lý file cấu hình khác. Để thử bằng role EC2 sau này, bỏ `--profile` và dùng credential chain của role phù hợp.

### Script làm những gì?

1. Kiểm account và metadata mode; chỉ dùng client DB ở Sydney.
2. In owner `db-smoke-test`, file ID mới dạng `repo-test-UUID` trước khi ghi để có thể đối chiếu nếu lỗi giữa chừng.
3. Tạo một metadata có `record_type=smoke_test`, rồi đọc lại bằng hai khóa.
4. Thử tạo trùng, yêu cầu conditional write từ chối ghi đè.
5. Cập nhật upload_state=uploaded, giữ status=not_started; Query theo owner tìm lại item, dùng phân trang khi cần.
6. Ghi một audit `db_smoke_test`, actor=check_dynamodb.py; retry cùng sự kiện phải trả False.
7. Query lịch sử, xác nhận chỉ một audit; thử đổi nội dung cùng ID sự kiện phải bị từ chối.
8. Đóng client, in kết quả và giữ hai item thử để bạn xem trên Console.

Đây là **metadata tổng hợp**, không chứng minh một file thật đã được ghi lên local/S3. Script không upload byte, không gọi Lambda/Step Functions/SNS, không tạo user/index/table và không xóa dữ liệu. Mỗi lần chạy lại tạo file ID test mới; không dùng nó để retry một upload thật có kết quả chưa rõ.

### Kết quả mong đợi

```text
ACCOUNT: 018913575473
REGION: ap-southeast-2
OWNER ID: db-smoke-test
FILE ID: repo-test-...
PASS 1: create metadata
PASS 2: get metadata
PASS 3: duplicate metadata rejected
PASS 4: update upload fields
PASS 5: query owner metadata
PASS 6: write audit
PASS 7: identical audit retry is idempotent
PASS 8: query audit history
PASS 9: changed audit retry rejected
```

Cuối cùng có JSON `result=PASS`, owner_id, file_id và event_key. Nếu lỗi trước khi đủ 9 PASS, chưa kết luận toàn bộ test thành công.

### Đối chiếu Console

- `securedrive-files` → Explore table items → Query owner_id=`db-smoke-test`; thêm file_id đầy đủ in bởi script. Kỳ vọng record_type=smoke_test, upload_state=uploaded, status=not_started.
- `securedrive-audit-log` → Query file_id đúng giá trị trên. Kỳ vọng một sự kiện mới có action=db_smoke_test và actor=check_dynamodb.py.
- Giữ dữ liệu để đối chiếu hoặc nhờ người có quyền dọn đúng hai item theo khóa đã in; không xóa bảng/prefix dùng chung.

## 5. Quyền và lỗi thường gặp

| Hiện tượng | Xử lý |
|---|---|
| No module named boto3/pytest/dotenv | Cài requirements-dev bằng đúng Python venv |
| Set MAYSEC_METADATA_MODE=dynamodb | Kiểm .env và biến terminal ưu tiên |
| ProfileNotFound/NoCredentialsError/ExpiredToken | Kiểm profile/token; chưa phải lỗi schema |
| Account mismatch | Script dừng trước DB; đối chiếu account/profile được nhóm cấp |
| ResourceNotFoundException | Kiểm tên bảng và Sydney, trạng thái ACTIVE |
| AccessDeniedException | Kiểm action/resource policy của chính danh tính chạy script |
| ConditionalCheckFailedException ngoài các lần cố ý test | Kiểm item và payload theo ID đã in, không bỏ condition để ép ghi |
| ReadTimeoutError/5xx khi ghi | Có thể đã ghi; kiểm item và event_key trước khi retry |

files cần PutItem/GetItem/UpdateItem/Query. audit cần PutItem/Query; retry sử dụng `ReturnValuesOnConditionCheckFailure=ALL_OLD` để so nội dung cũ mà không thêm GetItem. Nếu policy giới hạn return values, quản trị viên cần đối chiếu điều kiện policy với cách test này. Lambda execution role vẫn cần quyền riêng, kết quả profile local không chứng minh Lambda đã có quyền.

## 6. API dùng khi ghép ở bước sau

```python
client = build_dynamodb_client(settings)
# Khi disabled: không tạo repository và giữ cách chạy cũ.
# Khi enabled: caller quản lý lifespan và đóng client.
files = FileMetadataRepository(client, settings.dynamodb_files_table)
audit = AuditLogRepository(client, settings.dynamodb_audit_table)
```

- `files.create_upload_record(...)`: tạo metadata trước S3; trả item mới, trùng khóa báo DynamoDBConflict.
- `files.get_file(owner_id, file_id)`: item hoặc None khi không tồn tại; lỗi DB vẫn ném exception.
- `files.mark_upload_completed(...)`: chỉ cập nhật upload_state/updated_at; không sửa kết quả quét hoặc status_time.
- `files.mark_upload_failed(..., outcome_unknown=True/False)`: phân biệt unknown/failed; không hạ trạng thái uploaded về lỗi.
- `files.list_files(owner_id, limit=20, start_key=None)`: QueryPage(items, next_key), thứ tự theo file_id, chưa phải thời gian upload.
- `audit.write_event(...)`: True khi thêm mới; False khi sự kiện giống hệt đã có; thay payload cùng event_key báo conflict. Caller phải giữ ổn định event_id và occurred_at khi retry. Không dùng thời điểm retry làm thời điểm sự kiện mới.
- `audit.list_history(file_id, limit=20, start_key=None)`: lịch sử theo event_key; caller kiểm quyền trên file trước khi gọi. next_key là dữ liệu nội bộ, API sau này cần encode/validate cursor.

`details` phải được lọc trước khi ghi: không raw PII, OCR text lớn hoặc webhook URL chứa secret. TypeSerializer không nhận Python float; dùng số nguyên cho byte/count, Decimal cho số thập phân nếu cần; Decimal có phần lẻ cần xử lý ở schema HTTP sau này. Item/count/summary vẫn chịu giới hạn DynamoDB.

Cập nhật metadata và ghi audit hiện là **hai thao tác độc lập**, chưa có transaction giữa chúng. Chưa có logic scan/quarantine/users/admin, GSI hay cơ chế phục hồi upload tổng thể. Route đã ghép bookkeeping upload; cần đối soát khi DB lỗi sau lưu byte, xem hướng dẫn API local.

Tham khảo AWS: [PutItem và conditional writes](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html), [phân trang Query](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.Pagination.html), [low-level client](https://docs.aws.amazon.com/boto3/latest/guide/clients.html).

# Triển khai AWS

Nguồn: [Lambda source](../../AWS/Lambda_AWS), [workflow STANDARD](../../AWS/Orchestration/State_machine.json), [IAM mẫu](../../AWS/IAM), [lịch cleanup](../../AWS/Orchestration/trash-cleanup-schedule.example.yaml). Quy trình này dùng mã nguồn hiện tại; kết quả kiểm tra profile/gói theo ngày nằm trong [archive](../archive/README.md).

## Chuẩn bị

Xác minh account/region, principal backend, Upload/Quarantine bucket, KMS, SNS, User Pool/App client và ARN workflow. Sao lưu code/config/policy cloud đang chạy; đối chiếu version/alias/checksum trước khi cập nhật.

Giữ ba bảng và khóa theo [mô hình dữ liệu](../reference/data-model.md), không reset bảng/quota/ledger hoặc chuyển owner. Bucket nguồn bật versioning và Object Created qua EventBridge với version-id, prefix uploads/. Bucket cách ly không kích lại workflow upload.

Backend S3 dùng Cognito và DynamoDB; ENV theo [tham chiếu cấu hình](../reference/configuration.md). Credentials chain của backend khác execution role Lambda/workflow. Server dùng IAM role thì bỏ AWS_PROFILE.

## Đóng gói Lambda

| Source | Tên gói/hàm |
| --- | --- |
| Lambda_AWS/scan_file/handler.py | securedrive-scan-pii |
| Lambda_AWS/quarantine/handler.py | securedrive-quarantine-file |
| Lambda_AWS/notification/handler.py | securedrive-notify |
| Lambda_AWS/trash_cleanup/handler.py | securedrive-trash-cleanup |

Handler cả bốn là handler.lambda_handler. Ba ZIP pipeline có handler.py + pipeline_common.py ở gốc; cleanup có handler.py + app/ chứa các module backend được dùng.

Builder và dependency cache chỉ giữ local theo .gitignore, bản clone mới không có sẵn. Trên máy có AWS/package_lambdas.py, từ gốc repo chuẩn bị wheel Linux:

```powershell
backend/.venv/Scripts/python.exe -m pip install --target AWS/tools/scan-deps-python312-x86_64 --platform manylinux2014_x86_64 --platform manylinux_2_28_x86_64 --implementation cp --python-version 3.12 --only-binary=:all: --no-compile -r AWS/Lambda_AWS/scan_file/requirements.txt
python AWS/package_lambdas.py
python AWS/package_lambdas.py --check
```

Builder tạo bốn ZIP trong AWS/build và kiểm source/dependency khớp. ZIP Scan phải có pypdf/cryptography/Pillow, target **Python 3.12, Linux x86_64 / Amazon Linux 2023**, đối chiếu runtime manifest. Không chạy wheel Linux bằng Python Windows. Runtime/architecture khác phải build dependency tương ứng.

Máy không có builder nhận bộ ZIP/manifest từ cùng commit và kiểm nội dung/cấu trúc trên; không dùng ZIP tổng bàn giao cũ làm source hiện hành. Không upload ZIP bàn giao tổng vào Lambda. Source, policy, workflow, backend và frontend bàn giao cùng phiên bản.

## Quyền theo principal

Đối chiếu policy mẫu với ARN/prefix/LeadingKeys thật; giữ trust policy, permissions boundary và KMS key policy cần thiết.

| Principal | Policy nguồn / quyền cần đối chiếu |
| --- | --- |
| Backend | [Cognito runtime](../../AWS/IAM/securedrive-cognito-runtime-policy.example.json): files Get/Query/Put/Update/Delete/ConditionCheck theo owner và partition nội bộ; users Get/Update; audit Get/Query/Put/Scan |
| Backend rescan/recovery | [Quota/rescan](../../AWS/IAM/securedrive-backend-quota-rescan-policy.example.json): DescribeStateMachine/StartExecution/DescribeExecution trên workflow/execution tương ứng |
| Backend S3/KMS | Upload/read version/abort multipart; ListBucketVersions/DeleteObject/DeleteObjectVersion nguồn/cách ly; đọc version cách ly và kms:Decrypt khi phục vụ nội dung |
| Backend Cognito | ListUsers/ListUsersInGroup, AdminEnableUser/AdminDisableUser trên đúng pool; directory/hồ sơ phục vụ quản trị |
| Scan | [Scan policy](../../AWS/IAM/securedrive-scan-pii-policy.json): đọc nguồn/version, Textract, files/audit, Put thông báo và thống kê billing-scan trong quota partition |
| Quarantine | [Quarantine policy](../../AWS/IAM/securedrive-quarantine-inline-policy.json): copy/kiểm đích, xóa nguồn/version, KMS, files/audit và Put thông báo |
| Notify | [Notify policy](../../AWS/IAM/securedrive-notify-lambda-policy.json): SNS Publish, files/audit và Logs; chỉ SNS/email |
| Step Functions | InvokeFunction các Lambda; [DynamoDB fallback](../../AWS/IAM/securedrive-sfn-dynamodb-policy.json): Update files, Put audit, Put files giới hạn partition thông báo |
| Cleanup | [Cleanup policy](../../AWS/IAM/securedrive-trash-cleanup-policy.example.json): files Scan/Query/Get/Update/Put/Delete, Put audit, list/xóa version ở cả hai bucket, Logs |
| EventBridge | StartExecution cho workflow upload; quyền invoke cleanup theo template |

Backend dùng partition UUID thật, !quota!, !folders!, !history!, !notifications!, gồm UUID zero cho scope hệ thống. Policy dev cũ giới hạn dev-user không đủ. Mẫu demo bổ sung nhỏ không thay policy runtime đầy đủ. IAM transaction dựa trên quyền từng thao tác/item; không có action riêng dynamodb:TransactWriteItems.

Role Lambda/workflow không kế thừa quyền profile backend. Nếu AccessDenied, đối chiếu thêm bucket policy, key policy, boundary và SCP. Không cấp quyền quản trị IAM/Lambda cho user ứng dụng để chạy tính năng.

## Thứ tự cập nhật

1. Chờ/đối soát lượt đang chạy; giữ cleanup DISABLED và chưa bật thao tác mới.
2. Áp dụng quyền bổ sung theo principal, đặc biệt role Step Functions trước workflow fallback và Put thông báo/billing cho role Scan/Quarantine.
3. Cập nhật cả ba Lambda pipeline cùng pipeline_common.py và dependency tương ứng. ZIP không tự đổi env/layer/runtime/architecture/memory/timeout/alias; kiểm từng phần.
4. Cập nhật workflow STANDARD có RouteOperation, RecoveryQuarantine, RecoveryNotify, PersistQuarantineFailure; giữ ctx.execution từ Execution.Id và source version. Recovery gọi Lambda đồng bộ, Task timeout 1000 giây, Lambda đồng bộ tối đa 900 giây.
5. Cập nhật backend, cài requirements.txt để có ReportLab; kèm assets/billing-policy.json, fonts và OFL. Cấu hình S3/DynamoDB/Cognito/bucket cách ly/ARN; restart mọi worker. Phát hành frontend cùng phiên bản.
6. Build/cập nhật Cleanup vì đóng gói module backend lifecycle/metadata/billing dùng chung. Giữ lịch DISABLED tới khi nghiệm thu.
7. Thử các ca trong [nghiệm thu](testing.md), rồi bật khả năng rescan/recovery và lịch cleanup theo phạm vi đã xác nhận.

Cờ MAYSEC_SCAN_PIPELINE_ENABLED điều khiển API/khởi tạo metadata, không tắt trigger AWS. Muốn ngừng tiếp nhận execution cloud phải thao tác trigger riêng theo kế hoạch triển khai.

## Cấu hình cần xác nhận

- Scan: STRICT_DB_WRITE=true, MAX_SCAN_BYTES=100000000, MIN_PDF_TEXT_CHARS=1 nếu đang có override cũ. Giới hạn còn lại tại [cấu hình](../reference/configuration.md), quy tắc OCR tại [chính sách quét](../policies/scanning.md).
- Scan có thể bắt đầu nghiệm thu với timeout 300 giây, memory ít nhất 1024 MB. Đây là cấu hình thử, không bảo đảm mọi PDF lớn chạy xong; bộ OCR chừa 15 giây ghi kết quả.
- Quarantine: QUARANTINE_BUCKET/KMS_KEY_ID thật. Backend MAYSEC_QUARANTINE_BUCKET_NAME khớp bucket đó. KMS key policy cho phép các principal cần đọc/copy.
- Notify: SNS_TOPIC_ARN và subscription phù hợp. Không dùng WEBHOOK_URL. Cách xử lý yêu cầu webhook cũ tại [phục hồi pipeline](pipeline-recovery.md).
- Cleanup: Python 3.12, handler.lambda_handler; FILES_TABLE/AUDIT_TABLE/UPLOAD_BUCKET/QUARANTINE_BUCKET; có thể bắt đầu nghiệm thu với 512 MB, timeout 300 giây. Mẫu lịch rate(1 hour) và quyền invoke; [chi tiết cleanup](trash-cleanup.md).
- Backend dùng DYNAMODB_*_TABLE, Lambda dùng FILES_TABLE/AUDIT_TABLE: cùng bảng. Không đưa AWS_PROFILE hoặc credentials vào Lambda.

## Chi phí, thông báo và dữ liệu cần giữ

Phát hành backend/JSON/frontend, ZIP Scan ghi thống kê và Cleanup giữ mốc đóng ledger đồng bộ. Put billing-scan là best effort, lỗi không chặn cách ly; audit/kết quả giữ dữ liệu để backend phục hồi. Không TTL/xóa ledger, audit, lịch sử purge hoặc snapshot/revision tài chính còn cần đối chiếu.

Worker chi phí chạy khoảng mỗi 60 giây khi backend có metadata/directory, dùng billing-monitor-lock chung với nút Đối chiếu ngay. Không khởi thêm lịch AWS song song cho cơ chế demo này. [Thiết kế chi phí](../design/billing.md).

Thông báo web mới được ghi ở Scan/Quarantine, fallback workflow và các transaction backend, kể cả browser đóng. IAM thông báo cần đúng partition; không thay bằng bật SNS. [Thiết kế thông báo](../design/notifications.md).

## Nghiệm thu, bàn giao và rollback

Health chỉ là readiness cấu hình/client. Nghiệm thu upload sạch/PII, OCR, cách ly, quyền, rescan, recovery, purge version, thư mục, thông báo, ledger và báo cáo theo [checklist](testing.md). Ghi commit, checksum/version Lambda/workflow, policy/principal, bucket/region, ARN/trạng thái lịch và bằng chứng theo file ID.

Rollback: dừng trigger/lịch/thao tác mới phù hợp, đối soát execution còn chạy và khôi phục code/config/policy đã sao lưu. Nội dung đã xóa vĩnh viễn không được phục hồi bằng rollback source.

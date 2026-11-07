# Cập nhật AWS cho MâySec

Dùng [hướng dẫn cài đặt](../docs/AWS-HANDOFF-QUICKSTART-2026-10-31.md) làm checklist chính. Tài liệu này chỉ giữ các ràng buộc triển khai; [phụ lục](../docs/AWS-HANDOFF-2026-10-31.md) tóm tắt IAM/dữ liệu và xử lý lỗi.

## Thứ tự

1. Xác minh account/region, principal backend, bucket Upload/Quarantine, KMS, SNS và ARN workflow STANDARD; sao lưu code/config/policy đang chạy.
2. Bổ sung IAM backend cho quota/lifecycle/activity và quét lại; role Lambda/Step Functions/EventBridge giữ quyền riêng.
3. Cập nhật đồng bộ ba Lambda pipeline với pipeline_common.py có guard rescan và Thùng rác. Đối chiếu workflow JSONata, ctx.execution và source version.
4. Cấu hình backend, gồm bucket cách ly và ARN, restart mọi worker; phát hành frontend từ repository.
5. Triển khai cleanup, role và lịch ở trạng thái DISABLED. Kiểm tra upload/quota/report/rescan/trash/restore/purge/history/notifications rồi mới bật lịch.

Source chưa tự triển khai lên AWS. /health chỉ xác nhận readiness cấu hình/client, không chứng minh quyền AWS đủ.

## Thành phần

| Thành phần | Yêu cầu |
| --- | --- |
| Upload bucket | Versioning Enabled; sự kiện Object Created/prefix uploads/ có version-id |
| EventBridge | Đúng bucket nguồn; quyền StartExecution vào workflow; Quarantine không kích lại luồng upload |
| Scan | FILES_TABLE/AUDIT_TABLE đúng; STRICT_DB_WRITE=true; S3 version read, Textract và files/audit |
| Quarantine | QUARANTINE_BUCKET/KMS_KEY_ID đúng; copy/kiểm tra đích, xóa version nguồn, KMS và files/audit |
| Notify | SNS_TOPIC_ARN (SNS/email); trạng thái giao nhận trên files và audit, Logs |
| Step Functions | STANDARD; InvokeFunction ba Lambda; ctx.execution=$states.context.Execution.Id |
| Cleanup | Python 3.12, handler.lambda_handler; FILES_TABLE/AUDIT_TABLE/UPLOAD_BUCKET/QUARANTINE_BUCKET; role riêng, Logs |
| Lịch cleanup | rate(1 hour), mặc định DISABLED; template có Lambda resource permission cho EventBridge |

Upload ZIP không tự sửa env/layer/IAM/runtime/timeout hoặc alias. Publish/trỏ alias đồng bộ nếu môi trường đang dùng version/alias. Không ghi đè bản cloud khác/newer mà chưa đối chiếu.

Cleanup đã dọn cả metadata thư mục hết hạn sau khi xóa hết nội dung của nhóm. Cập nhật ZIP và role cleanup: thêm Query trên files, PutItem trên audit; `AUDIT_TABLE` mặc định `securedrive-audit-log`. Giữ lịch DISABLED đến khi nghiệm thu. Xem [quy trình cleanup và thử lại](../docs/trash-cleanup.md).

Để bật các luồng thư mục và xem xét cách ly trên EC2, cập nhật backend/frontend và
đối chiếu policy backend với mẫu trong `AWS/IAM`. Thư mục dùng partition
`!folders!<owner_id>` trong bảng files hiện có. Chuyển nhóm tệp cần quyền ghi giao dịch
trên files. Gửi và duyệt yêu cầu cách ly ghi metadata cùng audit trong một giao dịch,
nên role backend cần quyền UpdateItem trên files và PutItem trên audit.
Cập nhật ZIP Scan để ghi thời điểm bắt đầu cho lượt quét mới.

Vận hành quét cần `states:DescribeExecution` cho execution của workflow đã cấu hình.
Các thao tác admin ghi thông báo vào partition `!notifications!<owner_id>`.
Khôi phục tệp cách ly mở lại quyền xem và tải từ đúng version S3 đã xác minh,
không tạo một sự kiện upload mới. Role backend cần quyền đọc đúng version cách ly
và giải mã KMS như khi admin tải bản cách ly. Giữ bản S3 đó trong thời gian tệp còn
hoạt động. Cập nhật ZIP cleanup để lịch sử giữ được trạng thái đã khôi phục sau khi xóa.

## Giới hạn quét

Upload dùng 100 MB = 100.000.000 byte; quota 1 GB/owner. Scan mặc định MAX_SCAN_BYTES=52.428.800 byte, OCR ảnh 10 MiB. Ngoài giới hạn/định dạng hỗ trợ phải unscanned/error, không nhận safe.

Ba ZIP pipeline không tự cài pypdf; dùng layer/dependency tương thích runtime nếu trích PDF trực tiếp. OCR thiếu trang/partial/rỗng không coi safe. Giữ timeout/memory đủ cho mẫu OCR nghiệm thu; source hiện phát hiện CCCD và số thẻ, không quét mã độc/mật khẩu/API key.

## Dữ liệu và tính an toàn khi thử lại

Giữ files owner_id/file_id, audit file_id/event_key và key uploads/{owner}/{file}/{filename}. Lambda chỉ cập nhật bản ghi đã tồn tại, đúng bucket/key/version/execution và đang active.

Copy cách ly lỗi giữ flagged; xóa nguồn lỗi là quarantine_delete_failed; hoàn tất mới quarantined. Ghi vị trí/bằng chứng copy trước khi xóa đúng version. Quarantine và Notify không thay upload_state.

Quét lại tạo request/execution mới nhưng đọc đúng source_version_id; chặn execution cũ. Rác/purged không được Lambda ghi sống lại. Xóa vĩnh viễn xóa Versions/DeleteMarkers rồi mới lưu lịch sử và bỏ metadata sống; lỗi giữ quota.

Thông báo SNS có trạng thái riêng theo result (sending/sent/failed/unknown). Nếu gửi chưa rõ kết quả, source không tự gửi lại sending/unknown. Admin dùng [xử lý pipeline](../docs/pipeline-recovery.md) để đối chiếu execution/bằng chứng, xác nhận thủ công hoặc gửi lại SNS với xác nhận nguy cơ trùng. Cập nhật đồng bộ ba Lambda/pipeline_common.py và workflow có RouteOperation/RecoveryQuarantine/RecoveryNotify trước khi bật thao tác này; backend dùng ARN và quyền Step Functions hiện có. Nhánh phục hồi không chạy lại OCR và không tự retry Task chưa rõ kết quả.

## Builder và kiểm tra hiện hành

Thông báo web hiện được ghi từ Scan/Quarantine và các transaction quản trị/thư mục, không phụ thuộc trình duyệt đang mở. Bổ sung `dynamodb:PutItem` trên bảng files cho role Scan và Quarantine, giới hạn LeadingKeys `!notifications!<UUID>` theo hai policy mẫu đã cập nhật. Backend cần scope thông báo UUID, gồm UUID zero dùng cho hộp thư admin và quyền directory hiện có. Không thêm ENV/bảng hoặc bật lại webhook. Cập nhật Lambda/common, backend và frontend đồng bộ; xem [triển khai và nghiệm thu thông báo](../docs/notifications.md).

Builder và test chỉ giữ local, không đưa vào Git. Các lệnh dưới đây cần bộ công cụ local tương ứng; CI không phụ thuộc chúng.

Từ gốc repo:

```powershell
python AWS/package_lambdas.py
python AWS/package_lambdas.py --check
```

Từ backend/: cài requirements-dev.txt rồi chạy .venv/Scripts/python.exe -m pytest tests -q. Từ frontend/: npm test, npm run build; cài trình duyệt bằng pnpm exec playwright install chromium rồi chạy npm run test:ui. Test UI tự dựng API Moto và frontend cục bộ, không cần service/AWS thật.

Bốn ZIP Lambda phải khớp source của cùng commit; kiểm tra local bằng --check trước khi bàn giao. Bộ kiểm thử không được đưa vào Git. Nghiệm thu toàn pipeline cloud vẫn thực hiện riêng bằng dữ liệu tổng hợp được phép.

Bàn giao source/config mẫu từ repository cùng các ZIP vừa kiểm tra; không dùng lại builder gói tổng đã bỏ. Khi rollback, tắt lịch/quét lại và khôi phục code/config đã sao lưu; nội dung đã xóa vĩnh viễn không khôi phục bằng rollback.

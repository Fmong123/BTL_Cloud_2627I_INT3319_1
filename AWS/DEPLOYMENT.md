# Cập nhật AWS cho MâySec

Dùng [hướng dẫn cài đặt](../docs/AWS-HANDOFF-QUICKSTART-2026-10-31.md) làm checklist chính. Tài liệu này chỉ giữ các ràng buộc triển khai; [phụ lục](../docs/AWS-HANDOFF-2026-10-31.md) tóm tắt IAM/dữ liệu và xử lý lỗi.

## Thứ tự

1. Xác minh account/region, principal backend, bucket Upload/Quarantine, KMS, SNS và ARN workflow STANDARD; sao lưu code/config/policy đang chạy.
2. Bổ sung IAM backend cho quota/lifecycle/activity và quét lại; role Lambda/Step Functions/EventBridge giữ quyền riêng.
3. Cập nhật đồng bộ ba Lambda pipeline với pipeline_common.py có guard rescan và Thùng rác. Đối chiếu workflow JSONata, ctx.execution và source version.
4. Cấu hình backend, gồm bucket cách ly và ARN, restart mọi worker; phát hành frontend từ repository.
5. Triển khai cleanup, role và lịch ở trạng thái DISABLED. Kiểm tra upload/quota/report/rescan/trash/restore/purge/history/notifications rồi mới bật lịch.

Source chưa tự triển khai lên AWS. /health chỉ xác nhận readiness cấu hình/client, không chứng minh quyền AWS đủ.

Cập nhật chi phí theo sử dụng: phát hành đồng bộ backend với `assets/billing-policy.json`, frontend, ZIP `securedrive-scan-pii` (thống kê lượt xử lý) và `securedrive-trash-cleanup` (đóng thời gian lưu). Policy `securedrive-scan-pii-policy.json` đã thêm PutItem giới hạn vào partition `!quota!<UUID>`; áp dụng khi cập nhật role, không mở quyền ghi toàn bảng. Backend đối chiếu tài khoản/cảnh báo mỗi khoảng 60 giây khi đang chạy và có directory; không cần lịch AWS mới cho demo. Không reset quota, sổ tài chính hay snapshot tháng cũ. Xem `docs/pay-as-you-go.md` trước khi phát hành.

Phiên bản v3 giữ bản ghi thống kê cần bổ sung cùng kết quả quét/audit; nếu Put thống kê lỗi thì quét/cách ly vẫn tiếp tục. Backend cần Query audit theo file và ghi vào sổ quota để phục hồi, đã nằm trong mẫu quyền runtime. Cleanup phải giữ bản ghi đang chờ khi purge. Các bản đối chiếu tháng cũ có revision, giữ bản trước khi nhận dữ liệu ghi muộn; không TTL/xóa sổ tài chính, audit hoặc snapshot revision nếu còn cần đối chiếu. Trang chi phí admin cho xem trạng thái worker và chạy đối chiếu thủ công. Lease `billing-monitor-lock` dùng chung giữa các worker và nút này; không khởi chạy thêm lịch AWS song song cho demo.

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

Upload dùng 100 MB = 100.000.000 byte; quota 1 GB/owner. Scan mặc định `MAX_SCAN_BYTES=100000000` byte, đồng bộ upload. Khi cập nhật Lambda `securedrive-scan-pii`, đặt biến môi trường `MAX_SCAN_BYTES=100000000` nếu đang có override cũ; chỉ upload ZIP không thay đổi biến môi trường. OCR ảnh giữ giới hạn 10 MiB trong source. PDF cần OCR đã dùng Textract bất đồng bộ và được qua bước kiểm tra dung lượng tới 100 MB; vẫn phải đáp ứng giới hạn số trang của Textract và thời gian xử lý. JPEG/PNG trên giới hạn OCR cần bước xử lý/chia ảnh riêng, không thể chỉ nâng hằng số lên 100 MB. Ngoài giới hạn/định dạng hỗ trợ phải unscanned/error, không nhận safe.

ZIP Scan mới có sẵn pypdf, cryptography và Pillow; target **Python 3.12, Linux x86_64 / Amazon Linux 2023**. Không dùng ZIP này với runtime/architecture khác. Đối chiếu `AWS/build/securedrive-scan-pii.runtime.json` trước khi cập nhật; native dependency trong ZIP phải giữ nguyên byte. Nếu cần runtime/architecture khác, phải build dependency tương ứng. PDF có mật khẩu báo `pdf_password_protected`, không chuyển mù sang OCR. Thiếu parser/crypto/decoder báo mã cấu hình riêng, không nhận safe.

PDF có lớp chữ, kể cả văn bản ngắn, được đọc trực tiếp; mặc định `MIN_PDF_TEXT_CHARS=1`. Nếu Lambda đang override giá trị cũ 20, đổi về 1 khi cập nhật. PDF scan/mixed và TIFF dùng Textract bất đồng bộ, đọc hết phân trang. PNG/JPEG dùng OCR đồng bộ; ảnh tối đa 5.000.000 byte được gửi bằng Bytes từ đúng version S3 đã đọc, ảnh lớn hơn dùng S3Object có Version. GIF/WebP được giải mã thành PNG trong bộ nhớ, quét mọi khung, không ghi bản tạm lên S3 và không giảm độ phân giải. Mặc định tối đa 50 khung (`MAX_OCR_FRAMES`); quá số khung/thời gian hoặc thiếu nội dung thì unscanned/flagged với extraction_complete=false. Không tự đánh dấu safe khi bỏ sót trang/khung.

Scan nên có timeout 300 giây và memory ít nhất 1024 MB cho tập mẫu nghiệm thu; bộ OCR chừa 15 giây để ghi kết quả trước khi Lambda hết hạn. Đây là cấu hình cần kiểm chứng theo tệp thực tế, không phải bảo đảm đọc mọi PDF lớn trong một lượt Lambda. Source hiện phát hiện CCCD và số thẻ, không quét mã độc/mật khẩu/API key.

Quy tắc ảnh cập nhật theo yêu cầu: OCR thành công, xác nhận đủ trang/khung và không thấy chuỗi CCCD/thẻ thì safe, kể cả ảnh phong cảnh không có chữ. PNG/JPEG cần DocumentMetadata.Pages=1 và không có warning/phân trang còn chờ; GIF/WebP phải OCR xong mọi khung. TIFF dùng PAGE block để xác nhận cả trang không có chữ. OCR lỗi/thiếu trang/khung vẫn error/unscanned; phần đã đọc thấy CCCD/thẻ vẫn flagged. Không áp dụng quy tắc ảnh không chữ này cho PDF; PDF có mật khẩu vẫn pdf_password_protected.

Workflow mới có `PersistQuarantineFailure`: nếu cả Lambda cách ly và Lambda ghi lỗi đều không chạy được, Step Functions ghi trạng thái thất bại, audit và thông báo web bằng transaction DynamoDB độc lập. Áp dụng `AWS/IAM/securedrive-sfn-dynamodb-policy.json` vào **role Step Functions** trước khi cập nhật workflow; cần UpdateItem trên files, PutItem trên audit và PutItem trên files giới hạn partition `!notifications!<UUID>`. Transaction chỉ cập nhật tệp flagged/pending khớp bucket/key/version/execution, không sửa kết quả quét, không copy/xóa S3, không ghi đè tệp đã cách ly hoặc trong rác. Nếu cả DynamoDB/quyền workflow cũng lỗi, execution báo `QuarantineFailurePersistenceFailed`; admin đối chiếu lại sau khi sửa quyền. RecoveryQuarantine có cùng nhánh ghi lỗi, không tự tạo yêu cầu cách ly mới.

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

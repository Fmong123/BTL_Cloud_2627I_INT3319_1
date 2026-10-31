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
| Notify | SNS_TOPIC_ARN, webhook tùy chọn; trạng thái giao nhận trên files và audit, Logs |
| Step Functions | STANDARD; InvokeFunction ba Lambda; ctx.execution=$states.context.Execution.Id |
| Cleanup | Python 3.12, handler.lambda_handler; FILES_TABLE/UPLOAD_BUCKET/QUARANTINE_BUCKET; role riêng, Logs |
| Lịch cleanup | rate(1 hour), mặc định DISABLED; template có Lambda resource permission cho EventBridge |

Upload ZIP không tự sửa env/layer/IAM/runtime/timeout hoặc alias. Publish/trỏ alias đồng bộ nếu môi trường đang dùng version/alias. Không ghi đè bản cloud khác/newer mà chưa đối chiếu.

## Giới hạn quét

Upload dùng 100 MB = 100.000.000 byte; quota 1 GB/owner. Scan mặc định MAX_SCAN_BYTES=52.428.800 byte, OCR ảnh 10 MiB. Ngoài giới hạn/định dạng hỗ trợ phải unscanned/error, không nhận safe.

Ba ZIP pipeline không tự cài pypdf; dùng layer/dependency tương thích runtime nếu trích PDF trực tiếp. OCR thiếu trang/partial/rỗng không coi safe. Giữ timeout/memory đủ cho mẫu OCR nghiệm thu; source hiện phát hiện CCCD và số thẻ, không quét mã độc/mật khẩu/API key.

## Dữ liệu và tính an toàn khi thử lại

Giữ files owner_id/file_id, audit file_id/event_key và key uploads/{owner}/{file}/{filename}. Lambda chỉ cập nhật bản ghi đã tồn tại, đúng bucket/key/version/execution và đang active.

Copy cách ly lỗi giữ flagged; xóa nguồn lỗi là quarantine_delete_failed; hoàn tất mới quarantined. Ghi vị trí/bằng chứng copy trước khi xóa đúng version. Quarantine và Notify không thay upload_state.

Quét lại tạo request/execution mới nhưng đọc đúng source_version_id; chặn execution cũ. Rác/purged không được Lambda ghi sống lại. Xóa vĩnh viễn xóa Versions/DeleteMarkers rồi mới lưu lịch sử và bỏ metadata sống; lỗi giữ quota.

Thông báo có trạng thái riêng theo kênh/result (sending/sent/failed/unknown). Nếu gửi chưa rõ kết quả, source không tự gửi lại sending/unknown; vận hành đối chiếu receipt/log trước khi quyết định. Chưa có API quản trị tự động cho việc này.

## Builder và kiểm tra hiện hành

Từ gốc repo:

```powershell
.\backend\.venv\Scripts\python.exe AWS\tools\build_trash_cleanup.py
.\backend\.venv\Scripts\python.exe AWS\tools\build_handoff.py --date 2026-10-31 --version 2.1
```

Từ backend/: .venv/Scripts/python.exe -m pytest -q. Từ frontend/: npm test, npm run build và npm run test:ui -- --project=chrome.

Không yêu cầu khôi phục script/test cũ. Bộ hiện hành có kiểm tra quota, report/rescan, guard và cleanup bằng client giả/Moto; nghiệm thu toàn pipeline cloud vẫn thực hiện riêng bằng dữ liệu tổng hợp được phép.

Gói handoff giữ local, có manifest/SHA256 và không chứa .env thật hoặc credentials. Khi rollback, tắt lịch/quét lại và khôi phục code/config đã sao lưu; nội dung đã xóa vĩnh viễn không khôi phục bằng rollback.

# Source AWS MâySec

| Đường dẫn | Trách nhiệm |
| --- | --- |
| Lambda_AWS/scan_file/ | Quét CCCD/số thẻ và trích xuất/OCR |
| Lambda_AWS/quarantine/ | Copy cách ly/KMS, xác minh rồi xóa nguồn |
| Lambda_AWS/notification/ | SNS/email và bằng chứng giao nhận |
| Lambda_AWS/trash_cleanup/ | Dọn tệp/cây thư mục hết hạn |
| Lambda_AWS/pipeline_common.py | Guard version/execution, metadata, audit và thông báo dùng chung |
| Orchestration/State_machine.json | Workflow STANDARD, upload/rescan/recovery/fallback |
| Orchestration/trash-cleanup-schedule.example.yaml | Lịch mẫu mặc định DISABLED |
| IAM/ | Policy mẫu theo principal/role |

Đóng gói dependency, bốn ZIP, cấu hình runtime/IAM, thứ tự phát hành và rollback theo [hướng dẫn triển khai](../docs/operations/aws-deployment.md). Builder chỉ giữ local theo .gitignore; bản clone mới không có sẵn.

Thiết kế tại [luồng hệ thống](../docs/design/system.md); quy tắc tại [quét/cách ly](../docs/policies/scanning.md), [vòng đời](../docs/policies/file-lifecycle.md); xử lý lỗi tại [phục hồi pipeline](../docs/operations/pipeline-recovery.md). Kiểm cloud theo [nghiệm thu](../docs/operations/testing.md).

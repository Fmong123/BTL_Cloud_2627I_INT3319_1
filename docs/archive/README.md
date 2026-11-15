# Tài liệu lưu trữ

Các file trong thư mục này giữ thông tin theo thời điểm phát triển hoặc bàn giao cũ. Chỉ dùng để tra cứu lịch sử. Chính sách và cách chạy hiện tại bắt đầu tại [mục lục tài liệu](../README.md).

## Báo cáo theo ngày — `reviews/`

| Báo cáo | Thời điểm |
| --- | --- |
| [Rà soát codebase](reviews/CODEBASE-REVIEW-2026-10-31.md) | 31/10/2026 |
| [Rà soát hệ thống](reviews/SYSTEM-REVIEW-2026-11-06.md) | 06/11/2026 |
| [Rà soát pipeline](reviews/PIPELINE-REVIEW-2026-11-13.md) | 13/11/2026 |

Giữ kết quả kiểm tra theo ngày; không coi các số lượng test, quyền profile hoặc hiện trạng triển khai trong báo cáo là kết quả mới.

## Hướng dẫn cũ — `legacy/`

| Bản lưu | Nguồn hiện hành thay thế |
| --- | --- |
| [AWS handoff quickstart](legacy/AWS-HANDOFF-QUICKSTART-2026-10-31.md), [phụ lục](legacy/AWS-HANDOFF-2026-10-31.md) | [Triển khai AWS](../operations/aws-deployment.md) |
| [Upload S3 nhánh cũ](legacy/upload_to_s3_guide.md) | [Phát triển local](../guides/local-development.md), [triển khai](../operations/aws-deployment.md) |
| [DynamoDB service](legacy/dynamodb-service-test-guide.md), [FastAPI local + DB](legacy/dynamodb-fastapi-local-test-guide.md) | [Kiểm tra và nghiệm thu](../operations/testing.md) |
| [AWS E2E](legacy/aws-pipeline-e2e-test-guide.md), [kiểm tra thủ công](legacy/aws-pipeline-manual-test-guide.md) | [Kiểm tra và nghiệm thu](../operations/testing.md) |
| [Schema đề xuất cũ](legacy/dynamodb-item-schema.md) | [Mô hình dữ liệu](../reference/data-model.md) |
| [Phase 3](legacy/phase3-api.md) | [API](../reference/api.md) |
| [Quota và scan gộp](legacy/quota-scan.md) | [Quota](../policies/storage-quota.md), [quét và cách ly](../policies/scanning.md) |

Các bản cũ có thể mô tả owner `dev-user`, quota cố định, trần scan cũ hoặc chức năng chưa ghép ở thời điểm viết. Những nội dung đó không thay hợp đồng hiện hành.

## Các tài liệu được tổ chức lại

| Tên cũ tại gốc docs/ | Vị trí hiện tại |
| --- | --- |
| api-guide.md | [guides/local-development.md](../guides/local-development.md) |
| api-contract.md | [reference/api.md](../reference/api.md) |
| frontend-guide.md | [design/frontend.md](../design/frontend.md) |
| cognito-backend.md | [guides/authentication.md](../guides/authentication.md) |
| cognito-demo.md | [guides/demo-login.md](../guides/demo-login.md) |
| admin-reports-accounts.md | [Tài khoản](../guides/admin-accounts.md), [báo cáo](../guides/admin-reports.md) |
| pay-as-you-go.md | [Chính sách](../policies/billing.md), [thiết kế](../design/billing.md), [snapshot định giá](../reference/aws-pricing-snapshot.md) |
| notifications.md | [design/notifications.md](../design/notifications.md) |
| admin-history.md | [operations/admin-history.md](../operations/admin-history.md) |
| pipeline-recovery.md | [operations/pipeline-recovery.md](../operations/pipeline-recovery.md) |
| trash-cleanup.md | [operations/trash-cleanup.md](../operations/trash-cleanup.md) |
| upload-test-guide.md | [operations/testing.md](../operations/testing.md) |

Hướng dẫn triển khai từ AWS/DEPLOYMENT.md đã hợp nhất vào operations/aws-deployment.md; file cũ chỉ dẫn tới nguồn này.

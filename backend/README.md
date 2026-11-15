# Backend MâySec

FastAPI nhận upload, quản lý metadata/quota, phục vụ nội dung đủ điều kiện và quản lý vòng đời tệp. Danh tính lấy từ access token Cognito; Local có chế độ dev.

| Thư mục/file | Nội dung |
| --- | --- |
| app/main.py, config.py, dependencies.py | App, cấu hình và dependency |
| app/routers/ | HTTP theo nhóm tệp/thư mục/auth/quản trị/chi phí |
| app/schemas/ | Request/response Pydantic |
| app/services/ | Nghiệp vụ, storage, DynamoDB, audit và billing |
| app/assets/ | Chính sách giá, font PDF và giấy phép |

- [Cài và chạy nhanh](../README.md#chạy-trên-windows); [chọn chế độ local/S3](../docs/guides/local-development.md).
- [ENV](../docs/reference/configuration.md), [API](../docs/reference/api.md), [mô hình dữ liệu](../docs/reference/data-model.md).
- [Xác thực](../docs/guides/authentication.md), [phân quyền](../docs/policies/access-control.md).
- [Triển khai AWS](../docs/operations/aws-deployment.md), [kiểm tra](../docs/operations/testing.md).

Swagger ở /docs, OpenAPI ở /openapi.json, readiness ở /health. Backend không phục vụ trang giao diện tại GET /.

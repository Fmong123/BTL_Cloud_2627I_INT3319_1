# Tài liệu MâySec

Tài liệu hiện hành được tổ chức theo chủ đề và đối chiếu với mã nguồn trong repository. [README gốc](../README.md) giới thiệu code, chức năng chung và cách chạy nhanh.

## Chính sách — `policies/`

| Tài liệu | Nội dung chuẩn |
| --- | --- |
| [Truy cập và phân quyền](policies/access-control.md) | Danh tính, owner, phạm vi user/admin và quyền đọc |
| [Dung lượng và quota](policies/storage-quota.md) | Đơn vị, giới hạn upload, dung lượng dùng/giữ chỗ và quota riêng |
| [Vòng đời tệp và thư mục](policies/file-lifecycle.md) | Đổi tên, di chuyển, rác, khôi phục và xóa |
| [Quét và cách ly](policies/scanning.md) | Định dạng, OCR, kết quả, quét lại và xem xét cách ly |
| [Chi phí sử dụng](policies/billing.md) | Giá demo, miễn phí, thời gian tính, làm tròn và cảnh báo |

## Thiết kế — `design/`

| Tài liệu | Nội dung chuẩn |
| --- | --- |
| [Hệ thống](design/system.md) | Thành phần, trách nhiệm và các luồng dữ liệu |
| [Frontend](design/frontend.md) | Bố cục, thao tác, đồng bộ, cache và phiên trình duyệt |
| [Thông báo](design/notifications.md) | Sự kiện web/SNS, chống trùng và biên nhận đọc |
| [Ghi nhận chi phí](design/billing.md) | Ledger, roster, đối chiếu, revision và phục hồi thống kê |

## Tham chiếu — `reference/`

| Tài liệu | Nội dung chuẩn |
| --- | --- |
| [API](reference/api.md) | Endpoint, payload, phân trang, trạng thái và lỗi HTTP |
| [Mô hình dữ liệu](reference/data-model.md) | Kiểu dữ liệu, khóa bảng/partition, metadata và ánh xạ |
| [Cấu hình](reference/configuration.md) | Biến môi trường backend/frontend/Lambda và ràng buộc |
| [Snapshot cơ sở định giá](reference/aws-pricing-snapshot.md) | Giá/giả định AWS đã lưu trong phiên bản chính sách |

## Hướng dẫn — `guides/`

| Tài liệu | Công việc |
| --- | --- |
| [Phát triển local](guides/local-development.md) | Chọn chế độ, cài và chạy trực tiếp |
| [Xác thực Cognito](guides/authentication.md) | Thiết lập đăng nhập và gọi API bằng access token |
| [Đăng nhập trình diễn](guides/demo-login.md) | Bật/tắt bộ chọn tài khoản và đồng bộ hồ sơ |
| [Quản trị tài khoản](guides/admin-accounts.md) | Quota, khóa/mở tài khoản và tiếp tục đồng bộ |
| [Báo cáo quản trị](guides/admin-reports.md) | Bộ lọc, ý nghĩa số liệu và xuất CSV/PDF |
| [Launcher Windows](../launcher/README.md) | Menu, cấu hình hiệu lực, log và quản lý tiến trình |

## Vận hành — `operations/`

| Tài liệu | Công việc |
| --- | --- |
| [Triển khai AWS](operations/aws-deployment.md) | Đóng gói, IAM, thứ tự cập nhật, nghiệm thu và rollback |
| [Phục hồi pipeline](operations/pipeline-recovery.md) | Thử lại cách ly, đối soát và gửi lại SNS |
| [Dọn rác hết hạn](operations/trash-cleanup.md) | Cleanup, lịch chạy, tiến độ và thử lại |
| [Lịch sử quản trị](operations/admin-history.md) | Tra cứu, phạm vi dữ liệu và giới hạn đọc audit |
| [Kiểm tra và nghiệm thu](operations/testing.md) | Kiểm tra source, test local và kịch bản AWS thật |

## Lịch sử — `archive/`

[Mục lục lưu trữ](archive/README.md) giữ báo cáo theo ngày và hướng dẫn cũ để tra cứu. Kết quả trong đó chỉ phản ánh thời điểm ghi nhận, không xác nhận cấu hình cloud hiện tại.

## Quy tắc cập nhật

- Mỗi tài liệu một chủ đề. Quy tắc nghiệp vụ nằm trong `policies`, cơ chế thực hiện trong `design`, trường/endpoint/ENV trong `reference`, bước thao tác trong `guides` hoặc `operations`.
- Liên kết đến nguồn chuẩn; không chép lại toàn bộ bảng giá, schema hoặc checklist triển khai.
- Đổi code phải đối chiếu tài liệu liên quan. Schema chính xác của tiến trình API đang chạy ở `/openapi.json`; nguồn code được dẫn trong từng chủ đề.
- Phân biệt khả năng trong source với việc đã triển khai/nghiệm thu cloud. Giữ báo cáo theo ngày trong `archive`.
- Sửa liên kết khi chuyển tài liệu; không dùng tài liệu lưu trữ làm hướng dẫn chạy hiện hành.

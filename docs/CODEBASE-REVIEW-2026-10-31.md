# Rà soát và hoàn thiện mã nguồn MâySec — 31/10/2026

Phạm vi: repository `BTL_Cloud_2627I_INT3319_1`, nhánh `AWS_Phong`; đối chiếu frontend, backend, launcher, Lambda, cấu hình triển khai và tài liệu. Báo cáo này cập nhật kết quả sau khi sửa các vấn đề phát hiện trong lần rà soát. Chưa triển khai lên AWS, chưa commit/push.

Theo lựa chọn của người dùng, tiếp tục dùng `dev-user`; không triển khai Cognito/JWT và không khôi phục các script/test cũ.

## Các vấn đề đã xử lý

| Vấn đề | Thay đổi |
| --- | --- |
| Launcher bỏ mất bucket cách ly và ARN quét lại | Bổ sung hai biến vào cấu hình và môi trường backend; thêm chỗ chỉnh bucket/ARN trong menu. ARN hiệu lực được bỏ trống khi pipeline tắt hoặc chạy Local/Demo. |
| Tệp đã xóa vĩnh viễn còn nằm trong Thùng rác | Ghép bản ghi `purged` từ lịch sử server vào dữ liệu thư viện và cache local theo đúng scope. Bản ghi đã xóa không bị phản hồi polling cũ làm xuất hiện lại; vẫn giữ lịch sử upload. |
| Lịch sử có thể lẫn giữa hai backend khi tải lỗi | Xóa dữ liệu lịch sử của scope cũ khi đổi scope mà yêu cầu mới thất bại; làm mới khi quay lại tab và khi bấm Làm mới. |
| Template cleanup tự bật trước nghiệm thu | Đổi mặc định thành `State: DISABLED`, đồng bộ hướng dẫn; chỉ bật sau khi kiểm thử xóa và khôi phục. |
| DELETE với ID không hợp lệ trả lỗi server | Kiểm tra ID trước lần đọc metadata đầu tiên, trả HTTP 400 nhất quán với các route còn lại. |
| Ca UI báo cáo quét phụ thuộc số request StrictMode | Kiểm tra kết quả hiển thị và số request tăng sau thao tác thay vì cố định một request; vẫn bảo đảm cập nhật trạng thái không gọi quét lại. |
| Tài liệu hướng dẫn các lệnh/file không còn tồn tại | Cập nhật các hướng dẫn hiện hành theo API, builder và test đang có; đánh dấu tài liệu theo mốc cũ là tài liệu lịch sử. Không bổ sung lại script/test cũ. |
| Source và CSS dư | Bỏ `UploadButton.jsx`, CSS riêng không dùng, helper/import không dùng; gom ba lớp CSS shell thành `shell.css` và giữ thứ tự cascade. |
| Chưa có cấu hình kiểm tra tự động | Thêm `.github/workflows/check.yml` để chạy backend pytest, frontend logic và build; không cấp AWS credentials hoặc triển khai. Workflow chưa được chạy trên GitHub. |

Các hướng dẫn chính hiện tại: [README](../README.md), [backend](../backend/README.md), [API guide](api-guide.md), [API contract](api-contract.md), [frontend](frontend-guide.md), [launcher](../launcher/README.md), [AWS](../AWS/README.md) và [triển khai](../AWS/DEPLOYMENT.md).

## Các quy ước đã thống nhất

- Đơn vị thập phân: KB/MB/GB; tối đa 100.000.000 byte/tệp, quota 1.000.000.000 byte/owner.
- Tệp trong Thùng rác và upload chưa rõ kết quả vẫn tính dung lượng; chỉ giải phóng khi xóa nội dung hoàn tất. Tệp chưa đủ điều kiện an toàn hoặc trong rác không được xem/tải nội dung.
- Thư viện, lịch sử upload và thông báo phân biệt scope backend/owner. Không suy ra đã xóa chỉ vì một lần danh sách thiếu tệp; cần bản ghi `purged` có xác nhận.
- Sáu trang frontend gồm Tổng quan, Tệp của tôi, Hoạt động xử lý, Thùng rác, Cài đặt và Hướng dẫn. Lưu metadata/lịch sử/thông báo theo giới hạn đã ghi trong hướng dẫn; không lưu File/blob hay credentials vào localStorage.
- Gói bàn giao v2.1 dùng allowlist, manifest SHA-256, bốn ZIP Lambda riêng và PDF xuất từ Google Docs; không chứa `.env` thật, credentials, dependency hay nội dung tệp người dùng. Frontend được phát hành từ repository đầy đủ.

## Kết quả kiểm tra sau sửa

| Kiểm tra | Kết quả |
| --- | --- |
| Backend pytest | 115 đạt; một cảnh báo deprecation của dependency test |
| Frontend logic | 46 đạt |
| Frontend production build | Đạt |
| Chrome toàn bộ qua Vite dev | 80/80 đạt |
| Chrome sau chỉnh nhỏ cuối về trạng thái xóa/đánh dấu | 21/21 đạt trong các suite lifecycle, quota-scan và favorites; các ca này nằm trong bộ đầy đủ, không cộng thành 101 ca độc lập |
| Cấu hình launcher với môi trường giả | Hai biến AWS được giữ trong S3/DB; ARN hiệu lực trống khi pipeline tắt hoặc Local/Demo |
| Định dạng YAML và Git diff | Đã kiểm tra cú pháp/định dạng; không có lỗi khoảng trắng mới |
| Google Docs/PDF handoff | Nội dung cài đặt và lịch cleanup đã đồng bộ; PDF 5 trang được kiểm tra bố cục |

Có ca hồi quy cho HTTP 400, tệp đã xóa không sống lại qua polling, cập nhật trạng thái không gọi quét lại và Thùng rác sau cleanup/refresh/reload. Các kiểm tra local/API giả không thay thế nghiệm thu AWS thật.

## Phần còn cần vận hành hoặc phát triển riêng

- **AWS thật:** cập nhật quyền, bốn Lambda, workflow/ARN, bucket cách ly và lịch cleanup theo handoff; restart backend và nghiệm thu bằng profile/role thực tế. Chưa xác nhận các thay đổi này đã có trên AWS đang chạy.
- **Upload/notification chưa rõ kết quả:** giữ trạng thái an toàn và dung lượng giữ chỗ; việc đối soát vẫn là thao tác vận hành theo hướng dẫn, chưa có màn hình quản trị tự động.
- **Tài khoản thật:** `dev-user` là chế độ hiện tại được chọn. Chưa có đăng nhập nhiều tài khoản; quota chưa đại diện cho người đăng nhập riêng biệt.
- **CI:** cần commit/push để GitHub chạy workflow; kiểm tra browser hiện được chạy local. Chưa bổ sung lại bộ kiểm thử AWS/launcher cũ.

Không còn các lỗi đã tái hiện trong phạm vi local nêu trên. Không khẳng định hệ thống đã sẵn sàng triển khai thật khi các bước nghiệm thu AWS chưa hoàn tất.

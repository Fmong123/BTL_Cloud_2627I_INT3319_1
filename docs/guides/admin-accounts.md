# Hướng dẫn quản trị tài khoản

Mở **Quản trị hệ thống → Quản trị tài khoản** bằng tài khoản admin. Phạm vi theo [chính sách truy cập](../policies/access-control.md), hạn mức theo [quota](../policies/storage-quota.md).

## Quản trị tài khoản

- Phạm vi chỉ gồm tài khoản có vai trò `user` trong Cognito; loại toàn bộ admin (kể cả admin đang đăng nhập), tài khoản chưa phân quyền. Admin không được chỉnh quota/trạng thái, đọc nhật ký hoặc thống kê tài khoản admin khác. Chặn tại API, kể cả gọi trực tiếp UUID; phạm vi thống kê và bản xuất cũng chỉ có user. Directory được đọc mới để thay đổi nhóm bên ngoài không bị cache giữ trong phạm vi quản lý.
- Danh sách có tìm tên/email/username/ID không phân biệt dấu, lọc trạng thái, phân trang 10 tài khoản. Khi nhập, gợi ý tối đa 8 user sau 250 ms; chọn bằng chuột hoặc ArrowUp/ArrowDown + Enter; Escape đóng, chọn một tài khoản áp dụng đúng ID. Thẻ tổng hợp chỉ tính user trong phạm vi quản lý. Cột vai trò và trạng thái tách riêng; ngày và giờ hai dòng như Tệp của tôi; nút thao tác có viền và tiêu đề và cột số liệu căn giữa.
- Xem đã dùng, đang giữ chỗ, còn lại, quota và lần đăng nhập ứng dụng gần nhất. Lần đăng nhập chỉ có dữ liệu từ khi hệ thống bắt đầu ghi hồ sơ, không suy đoán từ Cognito.
- Chỉnh quota theo MB thập phân (1 GB = 1.000 MB); hỗ trợ 0 để chặn upload mới khi tài khoản chưa dùng dung lượng, tối đa 10 TB. **Không cho giảm dưới đã dùng + đang giữ chỗ**. Tệp Thùng rác và cách ly vẫn tính quota. Mặc định 1 GB nếu chưa có thiết lập riêng.
- Cập nhật quota dùng cùng lease và kiểm tra token trong transaction như upload, kèm audit trong cùng transaction. Vì thế upload và giảm quota không thể cùng bỏ qua phần giữ chỗ. Quota ở `securedrive-files`, partition `!quota!<sub>`, bản ghi `settings`; không xuất hiện trong Drive. Thanh dung lượng cá nhân và API upload dùng chính quota này.
- Khóa/mở user thực sự gọi Cognito `AdminEnableUser` / `AdminDisableUser`; không đổi nhóm và không nâng user thành admin. API access chỉ chấp nhận `role=user`. Việc cấp hay thu hồi quyền quản trị nằm ngoài giao diện này.
- Trạng thái khóa/chờ đồng bộ được kiểm tra tại backend cho cả token cũ bằng hồ sơ `securedrive-users`. Bộ chọn demo tiếp tục xác minh vai trò từ directory.
- Thay đổi Cognito và DynamoDB không thể là một transaction chung: lưu yêu cầu chờ + audit trước, tạm chặn tài khoản đích, gọi Cognito rồi xác nhận hồ sơ + audit kết quả. Nếu một bước chưa rõ kết quả, danh sách hiển thị **Chờ đồng bộ**; mở Quản lý → **Tiếp tục đồng bộ** để thực hiện lại đúng yêu cầu đó. Không đánh dấu thành công khi chưa xác nhận được. Các thay đổi quyền dùng lease chung 5 phút và kiểm tra lại actor sau khi lấy lease.
- Cần nhập lý do; giao diện giữ request ID khi thử lại, backend kiểm tra revision để tránh ghi đè thay đổi mới hơn. Nhật ký hiển thị tối đa 50 sự kiện mới nhất, gồm người thực hiện, thời gian và thay đổi; nút **Thống kê** trong từng dòng mở báo cáo đúng tài khoản.


## API và điều kiện chạy

Các endpoint danh sách/gợi ý, quota, access và lịch sử được mô tả tại [API](../reference/api.md). Cần Cognito, hồ sơ, metadata và audit. Local không có các kết nối này dùng quota mặc định và không mô phỏng quản trị tài khoản. Quyền IAM và phát hành tại [triển khai AWS](../operations/aws-deployment.md).

Nghiệm thu bằng user thử: chỉnh quota rồi kiểm upload/đăng nhập lại; khóa/mở và tiếp tục yêu cầu chờ đồng bộ; kiểm admin không hiện trong danh sách và gọi UUID trực tiếp bị chặn; đối chiếu audit/thông báo. Thống kê tách riêng tại [báo cáo quản trị](admin-reports.md).

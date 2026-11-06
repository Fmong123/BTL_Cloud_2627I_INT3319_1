# Thông báo trong ứng dụng

Chuông và thông báo nổi dùng chung sự kiện, trạng thái đã đọc và cách mở nội dung. Email SNS là kênh riêng; lưu thông báo web không gửi thêm email hoặc webhook.

## Các tình huống đã bổ sung

- User gửi yêu cầu xem xét cách ly: metadata, audit và sự kiện hộp thư admin được ghi trong cùng giao dịch. Admin thấy thông báo trong chuông; bấm vào mở đúng owner/file và phần xem xét. Hộp thư chỉ trả sự kiện của tài khoản hiện có role=user. Tài khoản admin, kể cả tài khoản của chính người đang quản trị, không nằm trong phạm vi.
- Scan và Quarantine ghi kết quả vào thông báo của chủ tệp sau khi xác nhận metadata/audit, kể cả khi không có trình duyệt mở. Phát lại cùng kết quả có ID và thời điểm ổn định, không tạo bản trùng hoặc đặt lại trạng thái đã đọc. Nếu ghi thông báo lỗi, Lambda báo lỗi để lượt gọi lại có thể sửa phần còn thiếu, không báo thành công im lặng.
- Kết quả đối soát thử lại cách ly hiện cả trong chuông và thông báo nổi. Đổi quota ghi thông báo cùng transaction với quota/audit; bấm thông báo mở Cài đặt. Thử lại cùng request ID không tạo thêm thông báo quota.
- Tạo/đổi tên/di chuyển thư mục, chuyển nhóm tệp, chuyển rác, khôi phục và xóa vĩnh viễn có thông báo máy chủ. Thông báo mở thư mục đích hoặc Thùng rác, không dùng ID thư mục làm ID tệp. Vì transaction có thêm một bản ghi thông báo, giới hạn cây là **97 thư mục+tệp**, thay cho 98; quá giới hạn trả 409 trước khi ghi.
- Bảng thông báo dùng chữ 14–15px cho nội dung/nút; mốc thời gian/chú thích 13px. Trên màn hình nhỏ bảng bám viewport, có cuộn và chừa lề; đã kiểm tra 320px và 390px.

## Lưu trữ, đọc và phân quyền

- Giữ bảng `securedrive-files`, partition cá nhân `!notifications!<sub>` và key `created_at#id`. Không tính các bản ghi này vào quota hoặc thư viện tệp.
- Hộp thư admin dùng partition dành riêng `!notifications!00000000-0000-0000-0000-000000000000`. UUID zero là định danh hệ thống, không phải tài khoản đăng nhập. `GET /admin/notifications` cần admin và đọc mới directory; lọc chủ tệp role=user trước khi trả dữ liệu. Không cần fan-out tới mọi admin khi user gửi yêu cầu.
- Mỗi admin lưu biên nhận đã đọc riêng trong partition cá nhân. Admin A đọc không làm mất trạng thái chưa đọc của admin B. Khi chủ tệp đổi thành admin hoặc actor mất quyền, sự kiện quản trị bị loại khỏi API và bộ nhớ thông báo frontend ở lần đồng bộ kế tiếp.
- Sự kiện máy chủ có `server_event=true`. Browser chỉ được đánh dấu đã đọc; không được sửa tiêu đề, loại, nội dung hay đích mở. `POST /notifications` kiểm tra lại quyền khi ghi biên nhận admin. Trạng thái đọc chỉ chuyển sang true.
- Frontend đồng bộ khi online và trang đang hiển thị, mỗi 5 giây, khi mở lại tab hoặc sau thao tác thư mục/đọc thông báo. Lần tải lịch sử đầu không bật hàng loạt toast cũ. Mỗi nguồn đọc tối đa 20 trang × 100 bản ghi; trình duyệt giữ tối đa 2.000 sự kiện và tối đa 3 toast cùng lúc. Đây không phải push hệ điều hành và không thay audit log.
- Cập nhật này bảo đảm các kết quả mới được ghi bởi Lambda mới. Không tự dựng lại thông báo của mọi lượt quét lịch sử trước khi triển khai.

## Cập nhật môi trường đang chạy

1. Backend/frontend dùng cùng phiên bản; không thêm ENV hoặc bảng mới. Backend IAM hiện có phải cho phép đọc/ghi `!notifications!<UUID>` gồm UUID zero, và Cognito ListUsers/ListUsersInGroup để kiểm phạm vi admin. Không cấp quyền admin ứng dụng bằng IAM wildcard.
2. Bổ sung `dynamodb:PutItem` vào bảng files cho **role Scan và Quarantine**, giới hạn LeadingKeys `!notifications!<UUID>`; các quyền GetItem/audit hiện có vẫn cần. Mẫu đã cập nhật trong `AWS/IAM/securedrive-scan-pii-policy.json` và `securedrive-quarantine-inline-policy.json`. Notify tiếp tục chỉ SNS.
3. Build/đối chiếu cả bốn ZIP bằng builder local; cập nhật Scan/Quarantine/common và Cleanup tương ứng. Cài backend requirements, restart backend và build/phát hành frontend. ZIP source thay đổi không tự cập nhật IAM/cloud.
4. Nghiệm thu bằng hai user và hai admin thử: gửi yêu cầu, đọc riêng từng admin, thay role đích, đổi quota, thao tác thư mục, quét khi web đóng, replay Lambda và tải lại ở trình duyệt khác. Kiểm cả chuông, toast, liên kết, quota và audit. Không đưa token/nội dung nhạy cảm vào bằng chứng.

Kiểm thử local: `pytest tests`, `npm test`, `npm run build`, các script trình duyệt `test:ui`, `test:ui:folders`, `test:ui:pipeline` và `node tests/notifications-audit.browser.mjs`. Bộ test/builder vẫn giữ local theo gitignore của repository.

# Đăng nhập trình diễn

Bộ chọn đọc tài khoản từ Cognito, cấp phiên demo có chữ ký riêng; không giả access token Cognito. Chính sách quyền tại [truy cập](../policies/access-control.md).

## Bật và chạy

1. Cài dependency backend, giữ kết nối S3/DynamoDB đang dùng.
2. Sửa các dòng tương ứng trong backend/.env hoặc environment service:

   ```dotenv
   MAYSEC_AUTH_MODE=cognito
   MAYSEC_DEMO_LOGIN_ENABLED=true
   COGNITO_USER_POOL_ID=<User Pool thực tế>
   COGNITO_APP_CLIENT_ID=<App client thực tế>
   ```

3. Đối chiếu principal backend với policy Cognito runtime theo [triển khai AWS](../operations/aws-deployment.md); quyền directory/users không thay quyền storage/metadata.
4. Restart backend/frontend, mở web và chọn tài khoản. Dùng **Đổi tài khoản** để về danh sách.
5. Tắt MAYSEC_DEMO_LOGIN_ENABLED sau buổi trình diễn và restart backend.

Ai truy cập được app có thể chọn cả admin không cần mật khẩu. Phiên demo ở bộ nhớ browser, hết hạn sau một giờ; reload chọn lại. Nhiều worker phải dùng cùng MAYSEC_DEMO_SIGNING_KEY ngẫu nhiên ít nhất 32 ký tự; bỏ trống dùng key tạm và một worker, restart làm phiên cũ mất hiệu lực. Cấu hình mặc định/mẫu tắt demo.

## Tài khoản và đồng bộ

- Danh sách lấy từ đúng User Pool, refresh mỗi 30 giây ở màn hình chọn; backend cache tối đa 15 giây nhưng kiểm lại khi chọn.
- Tài khoản mới có trạng thái phù hợp, đang bật và thuộc nhóm user/admin thì chọn được. Không tự gán nhóm hoặc tạo danh sách frontend.
- Đồng bộ securedrive-users theo user_id=sub, giữ created_at; chọn tài khoản hoặc /me cập nhật last_login_at. Không lưu mật khẩu/token/AWS credentials.
- Drive/quota/lịch sử/thông báo tách theo sub. Không đổi owner hoặc chuyển dữ liệu dev-user cũ.
- Directory/DB lỗi trả lỗi dịch vụ, không thay bằng tài khoản giả.
- Không cần VITE_COGNITO_* cho bộ chọn; đăng nhập thông thường ở [Cognito](authentication.md).

## Phiên và điều hướng

Admin mở Tổng quan bảo mật; user mở Tệp của tôi. Admin vẫn có Drive riêng. Đổi tài khoản hủy request/preview và tạo workspace mới, cache tách theo API + sub; response cũ không dùng cho phiên mới. 401 đưa về chọn tài khoản.

Login/workspace dùng chung cấu hình API. Launcher đồng bộ theo port backend; trình duyệt giữ địa chỉ theo cấu hình khi lưu. Bản deploy dùng /api hoặc URL HTTPS thực tế, không loopback máy phát triển. Lỗi /auth/config, mạng, CORS và timeout hiển thị tại màn hình login.

Backend auth_mode=dev có lối vào không gian local, không tạo phiên Cognito giả. Demo upload trong workspace là mô phỏng byte, khác bộ chọn tài khoản này.

Các endpoint /auth/config, /auth/demo/accounts, /auth/demo/login và /me ở [API](../reference/api.md); kiểm tra đa tài khoản theo [nghiệm thu](../operations/testing.md).

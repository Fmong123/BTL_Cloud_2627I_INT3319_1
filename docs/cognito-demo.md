# Chọn tài khoản và phân quyền MâySec

## Chạy demo

1. Backend dùng code mới, cài `backend/requirements.txt`. Giữ S3, DynamoDB và pipeline đang dùng.
2. Trong `backend/.env` hoặc environment của service:

   ```dotenv
   MAYSEC_AUTH_MODE=cognito
   MAYSEC_DEMO_LOGIN_ENABLED=true
   COGNITO_USER_POOL_ID=ap-southeast-2_ZgGsJVM2u
   COGNITO_APP_CLIENT_ID=75a0p1bv9bihkmgrkrrbb6nk7p
   ```

3. Bằng đối chiếu/cấp policy trong `AWS/IAM/securedrive-cognito-runtime-policy.example.json` cho profile local và role EC2. Đây là mẫu theo account/bucket hiện tại, không phải bằng chứng policy đã được áp dụng. Kiểm tra lại KMS key và key policy. Bản bổ sung nhỏ `securedrive-cognito-demo-policy.example.json` chỉ đủ cho directory/users/history; không bao gồm quyền đọc bản cách ly và dữ liệu của mọi owner mới.
4. Restart backend và frontend, mở web. Bấm tài khoản để vào. Góc phải hiển thị tài khoản hiện tại; chọn **Đổi tài khoản** để quay lại danh sách.

Đã bật `MAYSEC_DEMO_LOGIN_ENABLED=true` trong `.env` local theo yêu cầu. Cấu hình mẫu và cấu hình mặc định vẫn là false. Không có thay đổi IAM hoặc dữ liệu AWS thật trong lần triển khai code này. Kiểm tra thật ngày 03/11/2026: profile `securedrive-key` còn bị từ chối `cognito-idp:ListUsers`, nên chưa đồng bộ được tài khoản lên bảng users thật.

Đây là chế độ trình diễn: người mở được app có thể chọn bất kỳ tài khoản đang hoạt động, kể cả admin, mà không cần mật khẩu. Backend cấp JWT phiên demo riêng, không giả mạo Cognito access token. Token ở bộ nhớ trình duyệt, hết hạn sau một giờ; reload chọn lại tài khoản. Tắt cờ sau buổi demo. Khi chạy nhiều worker, đặt cùng `MAYSEC_DEMO_SIGNING_KEY` ngẫu nhiên ít nhất 32 ký tự trên server; nếu không đặt, dùng một worker và các phiên cũ hết hiệu lực khi restart.

## Tài khoản mới và các bảng

- Danh sách đọc trực tiếp từ đúng Cognito User Pool, tự tải lại mỗi 30 giây ở màn hình chọn tài khoản. Có nút làm mới. Cache directory ở backend tối đa 15 giây; khi chọn tài khoản luôn kiểm tra lại từ AWS.
- Tài khoản mới tự xuất hiện, không sửa danh sách trong frontend. Tài khoản cần được bật, có trạng thái phù hợp và nhóm `user` hoặc `admin` để được chọn. Chưa có nhóm/đang tắt vẫn hiện nhưng không đăng nhập được. Nhóm admin được ưu tiên nếu có cả hai nhóm. Không tự gán admin hoặc đổi nhóm Cognito.
- `securedrive-users`: upsert theo `user_id=sub`; lưu username, tên, email nếu có, role, active, trạng thái Cognito, created_at/updated_at; chọn tài khoản hoặc gọi `/me` ghi last_login_at. Không lưu mật khẩu, token hoặc AWS credentials. Giữ created_at và các thuộc tính khác của item.
- `securedrive-files`: file có `owner_id=sub`; quota, lịch sử upload và thông báo có partition phụ theo cùng sub. Danh sách và thao tác đều kiểm owner ở server.
- `securedrive-audit-log`: giữ `file_id/event_key`; sự kiện có owner_id. Thêm sự kiện bắt đầu/hoàn tất/thất bại khi admin đọc bản cách ly; actor là sub của admin.
- Giữ nguyên schema/key của ba bảng. Không đổi chủ hoặc chuyển file cũ của `dev-user`. Không tạo thêm bảng hoặc tự thay IAM.
- Profile/quyền DB lỗi trả 503; không chuyển sang tài khoản giả hay gộp Drive. Thêm tài khoản mới cũng cần runtime IAM cho phép prefix/partition UUID của owner mới; mẫu runtime dùng scope UUID cho backend dùng chung, kiểm quyền từng request ở ứng dụng.

## API và giao diện

| API | Quyền/hành vi |
|---|---|
| GET /auth/config | Cờ demo và auth_mode, không trả secret |
| GET /auth/demo/accounts | Chỉ khi demo bật; đọc Cognito, đồng bộ users và trả danh sách |
| POST /auth/demo/login | Chỉ khi demo bật; chỉ nhận account_id, không nhận role hoặc owner tự khai |
| GET /me | Token hợp lệ; trả id/role như contract cũ và đồng bộ hồ sơ |
| GET /files/{id}/history | Chủ sở hữu; phân trang cursor, không trả raw findings hoặc nội dung nhạy cảm |
| GET /admin/quarantine | Chỉ admin; tệp cần chú ý của các user thuộc User Pool, phân trang |
| GET /admin/files/{id}?owner_id=UUID | Chỉ admin; metadata và báo cáo quét/trích xuất của tệp thuộc pool |
| GET /admin/files/{id}/history?owner_id=UUID | Chỉ admin; lịch sử phân trang, tên người/hệ thống thực hiện |
| GET /admin/files/{id}/content?owner_id=UUID | Chỉ admin; đọc đúng version của bản cách ly, ghi audit trước khi trả byte |

Drive cá nhân của admin vẫn chỉ chứa file của admin. Menu **Quản trị cách ly** là khu vực riêng cho tất cả user trong pool theo phạm vi đã thống nhất. User thường không thấy menu và gọi API trực tiếp bị 403. Không cho admin xóa/đổi chủ/khôi phục file của người khác qua các API này.

Trang quản trị dùng khung nội dung chung với Tệp của tôi/Thùng rác; có tìm tên, lọc chủ sở hữu và trạng thái ở server. Chọn tên tệp hoặc **Chi tiết** để xem kết quả, lý do, thống kê trích xuất và lịch sử. Tải bản cách ly xong sẽ cập nhật lịch sử; dữ liệu cũ chưa có thống kê hiển thị rõ là chưa có, không tự tạo kết quả.

Điều hướng chia hai nhóm: **Không gian cá nhân** (Tổng quan, Tệp của tôi, Hoạt động xử lý, bộ lọc cá nhân, Thùng rác) và **Quản trị hệ thống** chỉ dành cho admin (Tổng quan bảo mật, Quản trị cách ly). Chọn tài khoản demo admin sẽ mở Tổng quan bảo mật; user mở Tệp của tôi. Admin vẫn có Drive/quota riêng; bộ lọc **Tệp cách ly** chỉ chứa tệp của chính admin. Không bổ sung quản lý tài khoản hoặc giải phóng bản cách ly trên web.

Trang cách ly có tab Tất cả/Chờ cách ly/Đã cách ly/Cách ly lỗi, lọc chủ sở hữu và ngày cập nhật. Nút tải bản cách ly đặt trong Chi tiết. Chi tiết tệp cá nhân và quản trị dùng chung ba tab **Thông tin / Kết quả kiểm tra / Lịch sử**. Tổng quan bảo mật dùng API `/admin/overview`, không lấy số tệp đã tải trên giao diện làm tổng hệ thống. Trình duyệt user mở URL admin trực tiếp bị chặn ở giao diện; API tiếp tục kiểm require_admin.

Triển khai đồng thời frontend và backend, cập nhật Lambda `securedrive-scan-pii` bằng handler mới cùng `pipeline_common.py` ở gốc ZIP (giữ layer PDF). Các lượt quét mới ghi thêm thuộc tính vào item files hiện có; không đổi khóa bảng, không cần GSI hoặc quyền IAM mới ngoài policy runtime đã bàn giao. Không tự quét lại hay sửa dữ liệu cũ. Nghiệm thu thêm PDF scan nhiều trang, PDF có mật khẩu, ảnh OCR rỗng và lượt quét không đầy đủ trên AWS thật.

Đọc cách ly yêu cầu metadata active/uploaded, status quarantined hoặc quarantine_delete_failed, bucket đúng cấu hình, key thuộc đúng owner/file và khớp source_version_id, có quarantine_version_id. Không đọc nhầm bucket nguồn, không inline HTML hoặc tự chạy nội dung. Nếu ghi audit thất bại thì không trả byte. Quyền cần thêm: GetObject/GetObjectVersion ở quarantine và kms:Decrypt ở đúng key (kể cả key policy).

Frontend tự gửi Bearer token cho JSON, XHR upload, preview/download và API admin. Đổi tài khoản hủy request, đóng preview và remount workspace; cache, lịch sử và thông báo tách theo API + sub. Request/response cũ không được dùng cho phiên mới. 401 đưa về chọn tài khoản.

Frontend dùng chung một nơi chọn API cho đăng nhập và workspace. Launcher đồng bộ URL theo port backend; địa chỉ lưu trong trình duyệt chỉ áp dụng cho đúng cấu hình lúc lưu, nên không ghi đè port mới. Khi build trên EC2, dùng `VITE_API_BASE_URL=/api` hoặc bỏ biến để dùng cùng origin + `/api`; không đưa địa chỉ loopback của máy phát triển vào bản deploy. URL cấu hình có thể là đường dẫn `/api` hoặc URL HTTPS đầy đủ. Lỗi backend cũ thiếu `/auth/config`, lỗi mạng/CORS và timeout được báo rõ trên màn hình đăng nhập.

Chế độ backend `auth_mode=dev` có nút vào không gian local, không tạo phiên Cognito giả. Khi bật bộ chọn Cognito trong launcher, chế độ auth được giữ là cognito kể cả khi lưu local. Trang đăng nhập có khung độc lập, không dùng giới hạn chiều rộng/padding của main trong workspace; đã kiểm tra từ 320 tới 3440px trên dev và production.

Luồng Cognito thông thường vẫn dùng Authorization Code + PKCE. Có thể bật nút qua `VITE_COGNITO_DOMAIN`, `VITE_COGNITO_APP_CLIENT_ID`, `VITE_COGNITO_REDIRECT_URI`, `VITE_COGNITO_LOGOUT_URI`. Caddy cần bỏ prefix /api khi proxy, phục vụ /callback bằng index.html và cho body lớn hơn 100 MB để chứa multipart overhead. Địa chỉ callback/logout phải khớp cấu hình Cognito. Không cần các VITE Cognito này cho bộ chọn demo.

## Nghiệm thu AWS thật sau khi cấp quyền

1. GET /auth/demo/accounts trả ba tài khoản thật; kiểm tra item users có đúng sub/nhóm.
2. User1 upload; kiểm S3 key và item files/audit cùng owner. User2 không thấy file trong thư viện/quota/lịch sử, gọi ID của user1 bị 404.
3. Admin có Drive riêng; khu quản trị liệt kê bản cách ly của hai user. Đọc một bản cách ly; audit có actor admin, owner của file, thời gian và kết quả. User thường gọi API admin bị 403.
4. Tạo tài khoản mới trong Cognito, gán nhóm user; không sửa frontend, đợi tối đa một vòng refresh rồi chọn được tài khoản và có item users.
5. Đổi tài khoản khi đang tải/preview; file và thông báo của phiên cũ không xuất hiện ở phiên mới. Kiểm tra lại trên hostname demo/EC2.

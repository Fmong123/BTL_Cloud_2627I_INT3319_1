# Chính sách truy cập và phân quyền

Nguồn: [auth.py](../../backend/app/auth.py), [Cognito verifier](../../backend/app/services/cognito_auth.py), [admin_scope.py](../../backend/app/services/admin_scope.py), [router admin](../../backend/app/routers/admin.py) và [router tệp](../../backend/app/routers/files.py).

## Danh tính và owner

- Cognito cấp access token; backend xác minh chữ ký, thời hạn, User Pool, App client và nhóm. Không dùng ID token làm access token.
- `owner_id` là `sub` ổn định; không lấy từ username, email, AWS profile hoặc owner do client tự khai.
- Nhóm `admin` được ưu tiên nếu có cả `user` và `admin`. Tài khoản không có nhóm hợp lệ bị từ chối.
- `auth=dev` chỉ dùng Local/unconfigured, owner `dev-user`. S3 bắt buộc Cognito. Thiếu cấu hình không tự chuyển về dev.
- Dữ liệu `dev-user` cũ không tự chuyển chủ.

## Phạm vi quyền

| Phạm vi | User | Admin |
| --- | --- | --- |
| Drive, quota, lịch sử và thông báo cá nhân | Chính mình | Chính mình |
| Tài khoản, báo cáo, cách ly và vận hành quản trị | Không | Tài khoản hiện có role `user` trong User Pool |
| Dữ liệu cá nhân của admin khác qua khu quản trị | Không | Không |
| Sửa giá/cấp quyền admin qua ứng dụng | Không | Không có chức năng |

Dependency require_admin kiểm vai trò actor từ token đã xác minh và hồ sơ quản trị. API quản trị đọc mới directory để xác định phạm vi tài khoản đích; đích là admin hoặc chưa phân quyền bị chặn, directory lỗi trả lỗi dịch vụ. Các luồng access, history, inbox admin và billing còn kiểm actor mới trong directory. Không mô tả mọi route admin là đã kiểm lại nhóm actor ở directory: một số route tệp/báo cáo/danh sách vẫn dựa vào token và hồ sơ cho quyền actor. Sổ tài chính giữ số liệu khoảng từng được quản lý theo [chính sách chi phí](billing.md), không mở quyền đọc tệp của tài khoản đã rời phạm vi.

Khóa tài khoản gọi Cognito và cập nhật hồ sơ; yêu cầu chờ đồng bộ tạm chặn đích. Token cũ không bỏ qua kiểm tra hồ sơ trạng thái. Xem [quản trị tài khoản](../guides/admin-accounts.md).

## Đọc nội dung và phiên

Owner chỉ xem/tải khi `active + uploaded` và API trả `scan_status=safe` hoặc `restored`. Restored là quyết định mở lại quyền đọc đúng bản cách ly đã xác minh, không biến kết quả phát hiện thành safe. Xem [quét và cách ly](scanning.md).

Admin đọc bản cách ly của user qua API quản trị khi đủ trạng thái, đúng bucket/key/version và chưa restored. Ghi audit thành công trước khi trả nội dung. Quyền S3/KMS và key policy vẫn phải cho phép đọc.

Frontend gửi Bearer token cho JSON, upload và tải nội dung; đổi tài khoản hủy request, đóng preview và đổi scope cache theo API + sub. Quyền vẫn được kiểm tra tại backend.

## Lỗi và trình diễn

Thiếu/sai/hết hạn token trả 401; sai quyền 403; tệp ngoài owner qua API cá nhân 404; cấu hình/JWKS/directory chưa sẵn sàng 503. Cursor không thay token. CORS không thay xác thực.

Bộ chọn demo chỉ bật bằng cờ backend: người truy cập app có thể chọn cả admin không cần mật khẩu. Phiên demo có chữ ký riêng, không phải access token Cognito. Xem [hướng dẫn demo](../guides/demo-login.md).

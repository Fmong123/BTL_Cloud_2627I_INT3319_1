# Frontend MâySec — bản nhiều trang

Frontend tập trung cho desktop/laptop, giữ bảng màu pastel của MâySec và bổ sung nền tím than tương ứng cho dark mode. Backend chưa cần thay đổi trong bản này.

## Chạy trên máy

Trong thư mục `frontend`:

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd run dev --port 5173 --strictPort
```

Mở `http://127.0.0.1:5173/`. Vite mặc định bind loopback. React Router dùng hash nên các link `/#/files`, `/#/settings` mở trực tiếp trên hosting tĩnh mà không cần rewrite. Hash routing không giải quyết cấu hình asset base nếu deploy dưới subdirectory; cần đặt Vite `base` theo nơi deploy.

## Các trang và thao tác

- **Tổng quan:** thống kê trong phiên, tệp vừa thêm, kéo thả và lối tắt sang danh sách đã lọc.
- **Tệp của tôi:** tìm tên tiếng Việt không dấu, lọc loại/trạng thái/đánh dấu/24 giờ, sắp xếp tên/dung lượng/thời gian, list/grid, chọn nhiều.
- **Hoạt động tải lên:** hàng đợi tuần tự, hủy, thử lại các lỗi có thể thử lại. Chuyển trang không dừng upload.
- **Cài đặt:** Sáng/Tối/Theo hệ thống, kiểu hiển thị, sắp xếp, chế độ trải nghiệm/lưu thật và kiểm tra kết nối.
- **Hướng dẫn:** cách thao tác, xử lý lỗi và ý nghĩa các trạng thái.

Nút tải lên dùng chung trên mọi trang. `Ctrl+K` chuyển đến tìm kiếm khi không đang nhập ở trường khác. Escape đóng modal và trả focus về nút mở. Bỏ khỏi danh sách có hoàn tác trong 8 giây; thao tác không xóa file trên storage. Chọn tất cả chỉ áp dụng cho kết quả đang hiển thị. Đổi bộ lọc hoặc trang sẽ bỏ lựa chọn.

Tệp trùng trong phiên được so tên, kích thước và thời gian sửa, không hash nội dung hoặc kiểm tra server. Có thể bỏ qua hoặc chủ động tải thêm.

## Theme và trạng thái được lưu

`localStorage` dùng key `maysec.preferences.v1`, chứa phiên bản schema, theme, list/grid, sort, mode và base URL. Mặc định theo theme hệ điều hành. Theme được áp dụng trước React để tránh chớp nền sai; cập nhật theo hệ thống khi chọn System. Màu dùng token theo vai trò trong `src/styles.css`, gồm nền, chữ, viền, điều khiển, gradient và các trạng thái lỗi/thành công.

Không lưu byte tệp, danh sách tệp, ID/key upload hoặc lịch sử upload. Refresh bắt đầu phiên mới; tệp đã được ghi thật vẫn có thể còn trên máy chủ. Khi localStorage bị chặn/đầy, app dùng được trong phiên và hiện thông báo.

## Kết nối API

Giữ nguyên `POST /upload` multipart trường `file`; thêm client gọi `GET /health` để kiểm tra phản hồi/config, timeout 5 giây. Đổi địa chỉ hoặc rời Cài đặt hủy lượt kiểm tra cũ. Kết quả cũ không được ghi đè địa chỉ mới. Kết quả hợp lệ gồm `status`, `storage`, `storage_configured`, `max_file_size_bytes` theo backend hiện tại.

Sau khi kiểm tra thành công và lưu đúng kết nối, giới hạn server áp dụng cho tệp mới. Trước đó dùng `VITE_MAX_FILE_SIZE_MB` và ghi chưa xác minh. Health không chứng minh storage ghi thành công. Lỗi validation không có nút retry; HTTP 5xx, 408/429 và lỗi mạng có thể thử lại thủ công. Không tự retry vì backend chưa có idempotency.

Trạng thái upload, nơi lưu và quét dữ liệu độc lập. Backend từ `main` đã có `GET /files` và `GET /files/{id}/status` khi bật metadata DynamoDB; frontend hiện chưa nối đồng bộ danh sách hoặc polling kết quả quét. Chưa có download, xóa server hoặc tài khoản; UI không khẳng định tệp đã an toàn.

## Kiểm thử và build

```powershell
pnpm.cmd test
pnpm.cmd run test:ui
pnpm.cmd run build
```

Unit tests kiểm tra parser API, health/timeout, tùy chọn, bộ lọc, retry, trùng tệp và tương phản token màu. UI tests dùng Chrome và Edge đã cài trên Windows, tự khởi động Vite trên port 5174. Nếu máy chưa có các trình duyệt đó, cài chúng hoặc điều chỉnh channel trong `playwright.config.js`.

UI tests kiểm tra chuyển trang khi upload, 200 tệp, list/grid, chọn nhiều/hoàn tác, lưu và đổi theme hệ thống, localStorage bị chặn, bàn phím, modal, giới hạn từ API, stale health response, các viewport 1280×720/1440×900/1920×1080 và không gian tương đương zoom 125%/150%. API trong UI test được giả lập; kết quả này không phải nghiệm thu AWS thật. Screenshot/trace nằm trong `frontend/test-results/` và không commit. `pnpm.cmd run format` định dạng source và test bằng Prettier.

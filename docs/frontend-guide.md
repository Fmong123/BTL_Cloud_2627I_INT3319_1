# Giao diện MâySec hiện tại

Cập nhật 04/11/2026. Cài/chạy theo [API guide](api-guide.md); API theo [contract](api-contract.md). Sáu trang cá nhân: Tổng quan, Tệp của tôi, Hoạt động xử lý, Thùng rác, Cài đặt và Hướng dẫn. Admin có thêm Tổng quan bảo mật và Quản trị cách ly. Cấu hình đăng nhập ở [Cognito demo](cognito-demo.md).

## Bố cục và thao tác

- /files dùng toàn bộ bề rộng có thể dùng. Chọn một/nhiều tệp mở panel chi tiết đơn/nhóm; đóng panel lấy lại chỗ cho bảng.
- /overview và /uploads dùng chung FileBrowser, bảng và panel. Tổng quan giữ năm tệp mới nhất; thống kê vẫn tính toàn thư viện.
- Sidebar có quota 1 GB, mở rộng/thu gọn; giao diện sáng/tối nhất quán. Header có tìm kiếm thật, ô tìm trong danh sách đồng bộ qua query q.
- Upload nằm trong thanh công cụ danh sách; chọn hoặc kéo thả tối đa 5 tệp truyền song song, phần còn lại xếp hàng. Mỗi tệp tối đa 100 MB.
- Chọn theo trang 50 dòng, Shift chọn dải, tìm tiếng Việt không dấu, bộ lọc đã lưu, tùy chọn cột/mật độ và kéo độ rộng cột tên.
- Ngày thêm là dòng chính; giờ HH:mm ở dưới. Định dạng hiển thị ngắn như PNG/PDF, MIME gốc ở thông tin kỹ thuật.
- CSS giao diện ở styles.css (tokens/cơ bản), shell.css (khung/sidebar/header), file-workspace.css (thư viện/panel/rác), admin-quarantine.css (quản trị) và auth/login.css (đăng nhập).
- Trang quản trị dùng khung chung với thư viện; bảng căn tiêu đề/dữ liệu theo từng cột, ngày và giờ tách dòng. Cài đặt căn giữa với chiều rộng tối đa 1480px. Login có bố cục riêng, tự chuyển một cột trên điện thoại.

## Dữ liệu và đồng bộ

Lưu trữ thật gọi FastAPI; web không gọi AWS trực tiếp. Thư viện đọc đủ các trang /files; backend có lifecycle thì dùng area=all. Frontend lọc/sắp xếp metadata đã tải. Làm mới đọc cả danh sách và lịch sử đã xóa.

Một bộ điều phối kiểm trạng thái tối đa bốn request cùng lúc, poll 3–10 giây khi cần, tạm dừng khi ẩn/offline và có giới hạn chờ. Cập nhật trạng thái chỉ đọc; có phản hồi đang kiểm tra/thay đổi/không đổi/lỗi. Quét lại là POST riêng.

History purged từ server đối soát cả cache và Thùng rác. Tệp đã xóa không xuất hiện lại do một response cũ. Không suy ra đã xóa chỉ vì lần list thiếu/lỗi. Kết nối khác có scope riêng; lỗi lịch sử của backend mới không lấy lịch sử backend cũ.

## Preview, download và báo cáo

Chỉ mở/tải tệp API đã uploaded, scan safe, lifecycle active và có capability đọc. Ảnh PNG/JPEG/GIF/WebP tối đa 10 MB, PDF 20 MB, văn bản UTF-8 TXT/CSV/JSON 1 MB để preview; download 100 MB.

Browser nhận NDJSON, dựng blob để tránh giao trực tiếp URL nội dung cho trình tải ngoài. Save As chạy trước fetch nếu trình duyệt hỗ trợ; hủy không tải. Trình duyệt khác dùng download thông thường. Không hứa mọi trình duyệt đều mở hộp chọn thư mục.

Báo cáo hiển thị tổng phát hiện, loại/số lượng và thời điểm; chỉ cảnh báo đọc chưa đủ khi có bằng chứng. Quét hiện hỗ trợ CCCD và số thẻ, không phải kiểm tra mã độc. Dịch vụ quét lại cần AWS/ARN/quyền sẵn sàng; tệp trong rác/cách ly không được giải phóng qua nút này.

## Thùng rác và đổi tên

Đổi tên chỉ đổi tên hiển thị. Rác giữ 30 ngày và vẫn tính quota; restore giữ nguyên kết quả quét/cách ly. Xóa vĩnh viễn có xác nhận, chỉ giảm quota sau khi server xác nhận hết nội dung/version. Lỗi một phần giữ trạng thái chờ xóa để retry.

Cleanup server chỉ chạy sau triển khai và bật lịch. Demo chỉ mô phỏng metadata. Bỏ khỏi danh sách/Hoàn tác là thao tác lịch sử UI; không xóa nội dung trên server.

## Ghi nhớ sau reload

localStorage:
- maysec.preferences.v2: theme, kết nối, sidebar, cột, sort/view, mật độ và bộ lọc.
- maysec.upload-history.v1: metadata lượt upload, tối đa 2.000 bản.
- maysec.notifications.v1: sự kiện và trạng thái đọc, tối đa 2.000 bản.

Các dữ liệu cá nhân trong trình duyệt được tách theo API + sub; đổi tài khoản hủy request cũ và tạo lại workspace. Không lưu File/blob, byte nội dung, URL blob hoặc credentials. Tệp tải dở không tự gửi lại sau reload; phải chọn lại bản gốc. API đồng bộ thông báo và snapshot lịch sử đã xóa khi capability persistent_activity sẵn sàng. Các đợt upload được nhớ trên trình duyệt tạo chúng, không phải lịch sử batch toàn tài khoản.

Thông báo là sự kiện web đã quan sát, không thay audit log/push nền. Storage trình duyệt bị chặn vẫn cho dùng trong phiên và báo chưa lưu. Quota server là nguồn chuẩn khi có capability; fallback thư viện có nhãn tạm tính.

## Chạy và kiểm tra

Test/script hỗ trợ chỉ giữ local và không được đưa vào Git. Bản clone mới dùng `pnpm install`, `pnpm run dev` hoặc `pnpm build`; các lệnh test dưới đây cần nhận bộ test local riêng.

Từ frontend/:

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd run dev --port 5173 --strictPort
npm.cmd test
npm.cmd run build
pnpm.cmd exec playwright install chromium
npm.cmd run test:ui
```

Khi có bộ test local, `npm test` chạy kiểm thử phiên/API và cấu hình địa chỉ máy chủ. `npm run test:api-client` chỉ chạy nhóm phiên/API. CI chỉ kiểm tra cú pháp Python và build frontend, không chạy test local.

Test UI cần Python và các gói `backend/requirements-dev.txt`. Mặc định tự build frontend và chạy qua proxy `/api`; `npm run test:ui:dev` kiểm chế độ Vite dev/CORS. Cả hai tự dựng FastAPI với S3/DynamoDB Moto, dùng tài khoản/khóa thử và cổng 8019/5189; không kết nối AWS thật. Ảnh kiểm tra ở `frontend/test-results`, được bỏ qua trong Git. Giữ hai cổng trống khi chạy.

Tự tìm Python trong backend/.venv theo Windows/Linux; đặt biến `PYTHON` nếu dùng interpreter khác. Mặc định dùng Chromium do Playwright cài. Có thể đặt `CHROME_EXECUTABLE` thành đường dẫn tuyệt đối tới Chrome đang có để dùng trình duyệt đó.

Đã có đăng nhập Cognito/demo, Drive riêng theo sub, lịch sử tệp và quản trị cách ly toàn pool. Chỉ bật đăng nhập một chạm trong môi trường trình diễn có chủ đích. Admin vẫn có Drive riêng; user không được gọi API admin. Chưa có quản lý thư mục/chia sẻ, lịch sử version giao diện hoặc tải nhiều tệp thành ZIP. Build web không tự triển khai AWS.

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

Thông báo gồm sự kiện máy chủ (kết quả quét/cách ly, quota, thư mục và yêu cầu xem xét tới admin) cùng thao tác web, không thay audit log/push hệ điều hành. Xem [luồng thông báo](notifications.md). Storage trình duyệt bị chặn vẫn cho dùng trong phiên và báo chưa lưu. Quota server là nguồn chuẩn khi có capability; fallback thư viện có nhãn tạm tính.

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

Đã có đăng nhập Cognito/demo, Drive riêng theo sub, thư mục nhiều cấp, lịch sử tệp và quản trị cách ly các tài khoản user thuộc pool. Tổng quan bảo mật, cách ly, tài khoản và thống kê dùng chung phạm vi user; không hiển thị/xử lý dữ liệu admin qua API quản trị. Chỉ bật đăng nhập một chạm trong môi trường trình diễn có chủ đích. Admin vẫn có Drive riêng; user không được gọi API admin. Chưa có chia sẻ, lịch sử version giao diện hoặc tải nhiều tệp thành ZIP. Build web không tự triển khai AWS.

## Xử lý riêng bước pipeline

Admin có phần **Xử lý cách ly và thông báo** trong tab Kết quả kiểm tra của chi tiết tệp. Danh sách Vận hành quét tập hợp cả tệp cần thử lại cách ly và thông báo SNS failed/sending/unknown. Nút kiểm tra đối chiếu execution và metadata; admin có thể xác nhận thủ công theo bằng chứng hoặc gửi lại SNS/email với xác nhận nguy cơ trùng. Giao diện không còn thao tác webhook; các sự kiện cũ hiển thị là kênh đã ngừng. Xem [hướng dẫn và triển khai đồng bộ](pipeline-recovery.md).

## Thư mục

Tệp của tôi mở thư mục gốc, có thẻ thư mục và đường dẫn để đi lên các cấp. Bấm **Thư mục mới** để tạo tại vị trí hiện tại; menu dấu ba chấm hoặc thanh thao tác của thư mục đang mở có **Đổi tên**, **Di chuyển đến…**, **Chuyển vào Thùng rác**. Không cho phép tên trùng trong cùng thư mục hoặc di chuyển một thư mục vào chính nó/thư mục con.

Chọn một hoặc nhiều tệp rồi bấm **Di chuyển đến…**, hoặc dùng menu từng tệp. Hộp thoại cho duyệt cây và tạo thư mục đích. Có thể kéo tệp/thư mục vào thẻ thư mục hoặc đường dẫn. Thả tệp từ máy lên thẻ thư mục sẽ upload vào đó; nút upload tải vào thư mục đang mở. Mỗi lượt upload ghi nhớ đích kể cả khi đổi trang hoặc thử lại. **Xem tất cả tệp** bỏ giới hạn thư mục; tìm/lọc thông thường áp dụng trong vị trí đang xem.

Xóa thư mục đưa cả cây và các tệp đang hoạt động bên trong vào Thùng rác 30 ngày. Phần Thư mục đã xóa cho xem nội dung, khôi phục cả nhóm hoặc xóa vĩnh viễn. Các tệp đã ở rác từ trước giữ nguyên trạng thái riêng. Nếu thư mục cha không còn khi khôi phục, thư mục trở về gốc; tên trùng được thêm hậu tố khôi phục. Tệp khôi phục riêng có thư mục cũ đã xóa vĩnh viễn cũng trở về gốc.

Tệp đang tải, đang quét hoặc flagged chờ cách ly chặn xóa cả thư mục. Thao tác xóa/khôi phục cây giới hạn **97 mục (thư mục + tệp)** mỗi lần để lưu nguyên khối; vượt giới hạn trả 409 và không đổi dữ liệu. Di chuyển tối đa 50 tệp/lượt. Thư mục là metadata, không đổi key S3 hoặc làm thay đổi kết quả quét/quota. Quota chỉ giảm sau khi nội dung được xóa vĩnh viễn thành công. Cleanup hiện có xóa nội dung tệp hết hạn; bản ghi thư mục hết hạn vẫn có thể dọn bằng nút xóa vĩnh viễn và không còn cho khôi phục.

Triển khai backend/frontend cùng phiên bản, restart backend và refresh web. UI thư mục bật khi `/health.capabilities.folders=true`; không mô phỏng thư mục trong chế độ demo/local không metadata. Không cần bảng/GSI mới. Quyền backend phải cho phép giao dịch và đọc/ghi partition `!folders!<owner>` trong bảng files, cùng ghi audit. Mẫu IAM Cognito runtime hiện có đã chứa partition này. Không tự thay IAM hoặc triển khai AWS.

Bộ test local mới: `npm run test:ui:folders` (Chrome trên Windows hoặc đặt `CHROME_EXECUTABLE`); dùng HTTP local/Moto, không truy cập AWS thật.

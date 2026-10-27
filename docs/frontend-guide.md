# Frontend MâySec — thư viện API và theo dõi xử lý

MâySec tập trung cho desktop/laptop, giữ palette pastel xanh–tím–hồng cùng dark mode. Có 5 trang: Tổng quan, Tệp của tôi, Hoạt động xử lý, Cài đặt và Hướng dẫn.

Sidebar có lối tắt Gần đây (24 giờ), Đã đánh dấu và Cách ly; mỗi lối tắt mở bộ lọc tương ứng trong Tệp của tôi. Cài đặt/Hướng dẫn nằm cuối sidebar. Cách ly chỉ liệt kê tệp được máy chủ xác nhận đã cách ly; trường hợp chưa hoàn tất vẫn ở khu Cần xử lý / Cách ly.

## Chạy và kiểm tra

Từ frontend/:

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd run dev --port 5173 --strictPort
pnpm.cmd test
pnpm.cmd run test:ui
pnpm.cmd run build
```

Mở http://127.0.0.1:5173/. HashRouter dùng /#/files và /#/settings; link trực tiếp trên hosting tĩnh không cần rewrite. Nếu deploy dưới subdirectory vẫn phải đặt Vite base phù hợp. Có thể chạy qua launcher ở gốc repo; kiểm tra cấu hình hiệu lực trước khi bật AWS. Browser tests dùng Chrome/Edge trên Windows, tự chạy Vite ở port 5174. Screenshot/trace ở frontend/test-results/ không commit. `pnpm.cmd run format` định dạng source/test.

`MAYSEC_TEST_PORT` đổi port riêng cho bộ kiểm thử khi cần chạy song song. `e2e/workspace.spec.js` kiểm luồng nền, `e2e/phase2.spec.js` kiểm thư viện/polling/upload và `e2e/phase2-visual.spec.js` kiểm 1.000 tệp, tên dài, bảng chi tiết ở 1280×720, 1440×900 và 1920×1080 trong hai theme.

## Luồng dữ liệu

**Web → FastAPI GET /files → DynamoDB → JSON → giao diện.** Web không truy cập DynamoDB trực tiếp. Nội dung file nằm trên S3 hoặc storage local; DynamoDB lưu metadata, trạng thái upload và kết quả xử lý. Không đưa credentials AWS vào frontend hoặc VITE_*.

- Demo giữ dữ liệu mô phỏng riêng, không gọi API, refresh mất danh sách.
- API + metadata hoạt động: đọc danh sách máy chủ theo cursor, ghép theo ID, refresh lấy lại thư viện. Đọc 100 metadata/lượt API; UI chia 50 tệp/trang và lọc/sắp xếp trên metadata đã đọc.
- Metadata bị tắt: upload vẫn theo storage đã chọn nhưng chỉ danh sách trong phiên được hiển thị, có nhãn rõ.
- Metadata lỗi: giữ dữ liệu đã đọc và báo lỗi; không tự chuyển demo hoặc coi thư viện trống.

Trong lúc chưa đọc hết các trang API, kết quả và số liệu được đánh dấu tạm thời. Có Làm mới và thời gian đồng bộ gần nhất. Kết quả từ kết nối cũ không được ghép vào backend mới. Thư viện server tách khỏi upload cục bộ: bản ghi API không có đối tượng File nên không thể retry upload.

## Quản lý tệp và upload

Tệp của tôi có tab Tất cả / Khu thường / Cần xử lý & Cách ly, bộ lọc loại/kết quả/thời gian, tìm không dấu, list/grid, chọn nhiều, và bảng chi tiết bên phải. Tổng quan có số liệu tổng tệp, đang xử lý, cần chú ý và đã cách ly; số liệu chưa đủ được ghi đang đồng bộ.

Upload chạy tối đa **5 tệp đồng thời**; tệp còn lại chờ. Chuyển trang không ngắt upload. Mỗi tệp có progress/hủy riêng; Hủy tất cả áp dụng những lượt chưa xong. Hủy phía trình duyệt không bảo đảm server chưa ghi nội dung. Đổi kết nối bị khóa khi còn hàng đợi, mỗi tệp ghi nhớ máy chủ ban đầu.

Nút Trải nghiệm / Lưu trữ thật mở menu tại chỗ; chỉ Cài đặt kết nối mới chuyển trang. Ctrl+K chuyển đến tìm kiếm khi không nhập ở trường khác. Tab di chuyển các điều khiển; Escape đóng panel/modal và trả focus phù hợp.

Chọn tất cả chỉ chọn tệp đang hiển thị trong trang UI; đổi khu/bộ lọc sẽ bỏ lựa chọn. Bỏ khỏi danh sách và Hoàn tác 8 giây chỉ áp dụng upload cục bộ trong phiên, không xóa file hoặc bản ghi server. Cảnh báo trùng dựa tên/kích thước/lastModified trong phiên; không hash nội dung hoặc dò server.

## Upload, Scan và Quarantine độc lập

Endpoints hiện có: POST /upload multipart trường file; GET /health; GET /files?limit=100&cursor=...; GET /files/{id}/status. Health kiểm cấu hình/client, không chứng minh IAM/storage ghi thành công; scan_status trên health là cấu hình khởi tạo, không phải kết quả từng file.

| scan_status | Ý nghĩa |
|---|---|
| not_started | Chưa bắt đầu quét |
| scanning | Đang chờ hoặc đang quét |
| safe | Lần quét không phát hiện dữ liệu nhạy cảm; không bảo đảm không có mã độc |
| flagged | Phát hiện dữ liệu nhạy cảm, chưa xác nhận cách ly hoàn tất |
| quarantined | Máy chủ báo đã cách ly |
| quarantine_delete_failed | Có bản copy cách ly nhưng chưa xóa được nguồn, cần xử lý |
| unscanned | Không quét được; xem status_reason |
| error | Lỗi xử lý, không suy ra an toàn |

Khu thường gồm not_started/scanning/safe. Khu cần xử lý gồm flagged/quarantined/quarantine_delete_failed/unscanned/error và backend upload failed/unknown. File tự chuyển khu theo trạng thái server. Không upload trực tiếp vào quarantine, download, xóa server hay khôi phục cách ly trong bản này.

Bảng chi tiết tách Thông tin và Xử lý; hiển thị findings_count/finding_types/status_reason, thời gian scan/cách ly và cập nhật gần nhất. Phần kỹ thuật chứa ID/key có thể sao chép. Không hiển thị PII nguyên bản, không dựng thời gian hay audit history không có trong API.

Bộ điều phối đồng bộ danh sách định kỳ khi tab hiển thị và có mạng. Poll tệp scanning/flagged hoặc upload chưa xác định, giới hạn **4 status request đồng thời**, backoff khi lỗi và thời gian chờ hữu hạn. Tạm dừng khi tab ẩn/offline, kiểm tra lại khi trở về. Hết thời gian chỉ báo chưa nhận kết quả mới; nút Kiểm tra lại chỉ đọc status, không kích hoạt Lambda. Phản hồi cũ không được ghi đè dữ liệu mới hơn.

Danh sách làm mới mỗi 30 giây; status mỗi 3 giây trong phút đầu rồi mỗi 10 giây. Tự theo dõi tối đa 10 phút hoạt động cho mỗi tệp; thời gian tab ẩn/offline không tính vào giới hạn. Lỗi mạng dùng backoff 5–30 giây.

Header X-File-Id/X-File-Key trong lỗi upload hỗ trợ đối soát: nội dung có thể đã lưu nhưng metadata/audit chưa xác nhận. Không tự gửi lại sau timeout hoặc kết quả chưa chắc chắn; kiểm tra trạng thái trước để tránh tạo bản sao.

## Thông báo và tùy chọn

Toast báo upload/scan/cách ly đổi trạng thái, gom thành công gần nhau và tối đa 3 toast. Chuông có Tất cả / Chưa đọc / Cần chú ý, đánh dấu đã đọc và mở đúng tệp. Lần nạp thư viện đầu không phát hàng loạt thông báo cũ; poll cùng trạng thái không tạo lại cảnh báo.

Giữ tối đa 200 thông báo trong phiên. Đây là sự kiện web đã quan sát, không phải audit log đầy đủ. Không xin quyền thông báo hệ điều hành. Refresh xóa thông báo và lịch sử upload cục bộ.

localStorage key maysec.preferences.v1 chỉ lưu theme, list/grid, sort, mode, base URL có phiên bản schema. Không lưu byte tệp/metadata/history/thông báo. Mặc định theme Theo hệ thống; áp dụng trước React để tránh chớp nền sai. Khi storage bị chặn/đầy, web vẫn dùng được trong phiên và báo không ghi nhớ tùy chọn.

## Giới hạn nghiệm thu

Unit/UI tests kiểm parser, phân trang, recovery header, ghép bản ghi, trạng thái, polling, notifications, đồng thời, danh sách lớn, bàn phím và hai theme. Browser tests giả lập API không nghiệm thu AWS thật. Cần môi trường S3–DynamoDB–Scan–Quarantine của nhóm thực sự ghi trạng thái/summary để xác nhận cloud. Web không triển khai hoặc gọi trực tiếp Lambda/Step Functions. Dùng dữ liệu nhạy cảm giả khi kiểm tra, không dùng PII thật.

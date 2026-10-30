# Frontend MâySec — thư viện API và theo dõi xử lý

Sidebar rộng 276px trên desktop, 236px dưới 1200px và 208px dưới 1000px; thu gọn còn 64px. Mục Bộ nhớ theo bố cục Google Drive, hiển thị dung lượng tệp đã xác nhận lưu trên toàn thư viện / gói miễn phí 1 GB (1.000.000.000 byte = 1.000 MB), không phụ thuộc tìm kiếm hay bộ lọc. Bản ghi upload và metadata cùng ID chỉ tính một lần; tệp đang tải, lỗi hoặc chưa xác nhận không tính vào số đã dùng. Kết quả chưa đồng bộ đầy đủ có nhãn tạm tính; demo có nhãn riêng. Đây là dung lượng logic từ metadata, không bao gồm phiên bản/bản sao S3; giới hạn 1 GB hiện để hiển thị, chưa chặn upload ở backend.

MâySec tập trung cho desktop/laptop, giữ palette pastel xanh–tím–hồng cùng dark mode. Có 5 trang: Tổng quan, Tệp của tôi, Hoạt động xử lý, Cài đặt và Hướng dẫn.

Sidebar có lối tắt Gần đây (24 giờ), Đã đánh dấu và Cách ly; mỗi lối tắt mở bộ lọc tương ứng trong Tệp của tôi. Cài đặt/Hướng dẫn ghim cuối sidebar; phần điều hướng và Bộ nhớ cuộn riêng khi màn hình thấp. Cách ly chỉ liệt kê tệp được máy chủ xác nhận đã cách ly; trường hợp chưa hoàn tất vẫn ở khu Cần xử lý / Cách ly.

Trang mặc định là Tệp của tôi. Ba trang Tệp của tôi, Tổng quan và Hoạt động xử lý dùng chung bố cục toàn bộ chiều rộng còn lại sau sidebar, lề 24px, nền gradient liền mạch với sidebar trong cả hai theme. Tiêu đề trang 28px, đường dẫn trên thanh đầu 20px, tiêu đề danh sách 20px; thanh công cụ, bộ lọc và kiểu hiển thị dùng chung một thành phần. Chọn một tệp mở panel chi tiết bên phải; chọn nhiều mở tổng hợp số lượng, dung lượng và trạng thái. Đóng panel trả lại chiều rộng cho danh sách và giữ lựa chọn; bỏ chọn hết đóng panel. Ở màn hình nhỏ panel xếp phía trên bảng. Sidebar thu gọn xuống 64px bằng nút có nhãn và tooltip, vẫn giữ trạng thái trang đang chọn; tùy chọn được ghi cùng theme trong preferences v2.

Tổng quan giữ bốn thẻ thống kê toàn thư viện và danh sách tối đa 5 tệp mới nhất. Bộ lọc/tìm kiếm trong danh sách này chỉ áp dụng cho 5 tệp đó; Xem tất cả mở thư viện đầy đủ. Hoạt động xử lý có thẻ tổng hợp số đang tải/chờ, đã tải, lỗi và chờ kết quả; lịch sử tệp dùng cùng bảng và panel như Tệp của tôi. Các đợt tải lên nằm dưới bảng, cuộn riêng khi danh sách dài; ngày đợt tải đậm ở trên và giờ HH:mm ở dưới.

Header có ô tìm kiếm tên tệp thật, đồng bộ từ khóa với ô tìm trong danh sách qua URL `q`. Gõ từ trang khác sẽ mở Tệp của tôi với từ khóa đó; Ctrl+K/Cmd+K chọn ô header. Nút Tải tệp lên nằm trong thanh công cụ danh sách, thay nút upload trên header bằng biểu tượng người dùng; biểu tượng hiện chưa có đăng nhập. Ảnh/PDF/văn bản đủ điều kiện có nút Xem ngay cạnh tên. Trạng thái quét dùng nhãn ngắn; bấm nhãn mở tab Xử lý với giải thích. Nút Cập nhật trạng thái chỉ đọc kết quả mới, không chạy lại quét. Nhóm tệp có thao tác xem/tải riêng cho từng tệp đủ điều kiện, chưa có tải ZIP hàng loạt.

Dòng “Kéo thả tệp vào danh sách” nằm ngay dưới nút Tải tệp lên trên cả ba trang. Kéo tệp từ Windows Explorer vào khung danh sách sẽ hiện vùng thả viền nét đứt cùng giới hạn dung lượng; thả tệp để thêm vào hàng đợi tải lên.

Tùy chỉnh hiển thị ở cả ba trang cho chọn mật độ Thoải mái/Gọn, ẩn cột kích thước/ngày thêm và đặt lại hiển thị. Các bảng dùng chung chữ tên tệp 16px, dữ liệu/tiêu đề cột 15px, badge trạng thái 13px; các cột thông tin căn giữa tiêu đề với dữ liệu, tên tệp căn trái. Cột Thời gian thêm đặt ngày đậm 15px ở trên, giờ 13px dạng HH:mm ở dưới, theo múi giờ thiết bị. Vạch kéo nằm giữa chiều cao tiêu đề. Kéo vạch cột tên hoặc dùng phím mũi tên/Home/End để đổi chiều rộng thực; mức tối đa phụ thuộc không gian và giữ đủ chỗ cho các cột còn lại. Độ rộng được lưu sau reload; Đặt lại hiển thị khôi phục tự giãn. Khi panel mở ở màn hình dưới 1650px, cột thời gian và tải lên được ẩn để ưu tiên tên/kết quả; thông tin đầy đủ có trong panel. Cột thao tác được ghim bên phải; tiêu đề bảng và thanh chọn nhiều giữ vị trí khi cuộn.

Bộ lọc thêm có Ngày thêm: hôm nay, 7/30 ngày hoặc khoảng ngày theo múi giờ thiết bị, bao gồm hết ngày kết thúc. Bộ lọc đã lưu giữ tối đa 10 cấu hình cho từng backend trên trình duyệt này, không lưu trang phân trang hay lựa chọn tệp. Có thể tải/xóa từng cấu hình; bộ lọc hiện tại vẫn nằm trên URL để Back/Forward hoạt động.

Shift-click checkbox chọn một khoảng trong trang; Ctrl+A/Cmd+A chỉ chọn trang hiện tại khi focus ở danh sách, không chiếm thao tác trong ô nhập. Escape đóng menu/panel trước rồi mới bỏ chọn. Thanh chọn hiển thị số tệp và tổng dung lượng.

## Xem trước, tải xuống và đợt upload

Mỗi lần chọn/thả tệp tạo một đợt upload trong phiên. Hoạt động xử lý hiển thị tổng số, số đã tải xong, đang tải/chờ, lỗi và chờ quét của từng đợt. Thử lại theo đợt chỉ gửi ID đủ điều kiện; các lượt thành công, lỗi đầu vào và kết quả chưa xác định không được tự gửi lại.

Đọc nội dung yêu cầu API hiện tại công bố `health.capabilities.file_content === true`, metadata `upload_state=uploaded`, `scan_status=safe` và ID máy chủ. Frontend gọi `GET /files/{id}/content?mode=preview` hoặc `mode=download`; không tự dựng URL S3 và không lấy nội dung tệp cách ly. Backend kiểm tra lại quyền/trạng thái khi đọc. Đây là khả năng riêng, không suy diễn từ việc metadata đã bật.

Nhấn tên tệp mở viewer nếu hỗ trợ, còn lại mở chi tiết. Viewer dùng dialog native; chỉ mở một nội dung, giữ vị trí cuộn, hủy fetch khi đóng/đổi tệp/kết nối, bỏ kết quả cũ và thu hồi object URL. Ảnh PNG/JPEG/GIF/WebP tối đa 10 MB; PDF tối đa 20 MB trong trình đọc native của trình duyệt có nút tải xuống dự phòng; TXT/CSV/JSON UTF-8 tối đa 1 MB hiển thị thành văn bản được escape. Không render HTML/SVG hoặc tài liệu từ URL bên ngoài. Tệp đủ điều kiện nhưng không hỗ trợ xem trước vẫn có thể tải xuống. Nếu trạng thái mất An toàn lúc viewer mở, viewer đóng và chuyển sang thông tin tệp.

Web yêu cầu nội dung dưới dạng luồng JSON/base64 theo từng khối, không có header attachment hay tên tệp tải xuống trên phản hồi API; Blob được tạo ngay trong trình duyệt để giảm trường hợp IDM bắt nhầm yêu cầu xem trước. Cần khởi động lại backend để bật luồng này. Định dạng bổ sung khoảng 33% dữ liệu truyền, giữ nguyên giới hạn dung lượng tệp gốc. Không thể bảo đảm mọi cấu hình tiện ích tải xuống đều bỏ qua nội dung.

Trình duyệt hỗ trợ `showSaveFilePicker` trên HTTPS hoặc localhost sẽ mở Save As ngay khi bấm Tải xuống, đề xuất tên tệp và thư mục Downloads. Chọn nơi lưu xong mới đọc nội dung API; Hủy không gửi yêu cầu lấy tệp. Chỉ báo Đã lưu sau khi ghi và đóng thành công; lỗi/đổi kết nối/trạng thái không còn được đọc sẽ hủy phần ghi đang dang dở. Trình duyệt khác dùng tải Blob thông thường, hỏi thư mục theo cài đặt tải xuống của trình duyệt.

Dung lượng dùng hệ thập phân: 1 KB = 1.000 byte, 1 MB = 1.000.000 byte, 1 GB = 1.000.000.000 byte. Tải lên tối đa 100 MB mỗi tệp, áp dụng ở frontend, backend và launcher; giới hạn máy chủ thấp hơn vẫn được tôn trọng. Cấu hình cũ 104.857.600 byte được chặn ở 100.000.000 byte. Tải xuống cũng tối đa 100 MB/tệp; menu, chi tiết, viewer và bảng chọn nhiều dùng cùng điều kiện, một lượt chuẩn bị nội dung tại một thời điểm. Với tải Blob dự phòng, thông báo chỉ xác nhận trình duyệt đã bắt đầu tải. Cần khởi động lại backend đang chạy để nhận thay đổi giới hạn; backend cũ không công bố capability sẽ không bật các thao tác nội dung. Contract và giới hạn nằm trong [phase3-api.md](phase3-api.md).

## Chạy và kiểm tra

Từ frontend/:

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd run dev --port 5173 --strictPort
pnpm.cmd test
pnpm.cmd run test:ui
pnpm.cmd run build
```

Nếu môi trường kiểm thử chặn localhost, chạy bản build qua route nội bộ của Playwright: `pnpm.cmd run build`, sau đó đặt `$env:MAYSEC_BUILT_APP='1'` và chạy `pnpm.cmd run test:ui`. Chế độ này đọc `dist/`, không khởi động Vite; các API vẫn được giả lập trong từng bộ test.

Mở http://127.0.0.1:5173/. HashRouter dùng /#/files và /#/settings; link trực tiếp trên hosting tĩnh không cần rewrite. Nếu deploy dưới subdirectory vẫn phải đặt Vite base phù hợp. Có thể chạy qua launcher ở gốc repo; kiểm tra cấu hình hiệu lực trước khi bật AWS. Browser tests dùng Chrome/Edge trên Windows, tự chạy Vite ở port 5174. Screenshot/trace ở frontend/test-results/ không commit. `pnpm.cmd run format` định dạng source/test.

`MAYSEC_TEST_PORT` đổi port riêng cho bộ kiểm thử khi cần chạy song song. `e2e/workspace.spec.js` kiểm luồng nền, `e2e/phase2.spec.js` kiểm thư viện/polling/upload và `e2e/phase2-visual.spec.js` kiểm 1.000 tệp, tên dài, bảng chi tiết ở 1280×720, 1440×900 và 1920×1080 trong hai theme.

## Luồng dữ liệu

**Web → FastAPI GET /files → DynamoDB → JSON → giao diện.** Web không truy cập DynamoDB trực tiếp. Nội dung file nằm trên S3 hoặc storage local; DynamoDB lưu metadata, trạng thái upload và kết quả xử lý. Không đưa credentials AWS vào frontend hoặc VITE_*.

- Demo giữ dữ liệu mô phỏng riêng, không gọi API, refresh mất danh sách.
- API + metadata hoạt động: đọc danh sách máy chủ theo cursor, ghép theo ID, refresh lấy lại thư viện. Đọc 100 metadata/lượt API; UI chia 50 tệp/trang và lọc/sắp xếp trên metadata đã đọc.
- Metadata bị tắt: upload vẫn theo storage đã chọn nhưng chỉ danh sách trong phiên được hiển thị, có nhãn rõ.
- Bản ghi metadata lỗi: bỏ qua riêng bản ghi đó, tiếp tục đọc các tệp hợp lệ và trang API kế tiếp. Hiện cảnh báo tổng số bản ghi bị bỏ qua, tên/ID và lý do lỗi (tối đa 10 chi tiết). Số liệu chỉ tính các tệp hiển thị; nếu mọi bản ghi đều lỗi thì không coi thư viện trống. Làm mới sau khi metadata được sửa sẽ tải lại bản ghi và xóa cảnh báo tương ứng.
- Lỗi mạng/HTTP hoặc cấu trúc trang API không hợp lệ: giữ dữ liệu đã đọc và báo lỗi; không tự chuyển demo hoặc coi thư viện trống. Nếu backend trả HTTP lỗi cho cả trang thay vì JSON danh sách, frontend chưa thể bỏ qua từng bản ghi.

Trong lúc chưa đọc hết các trang API, kết quả và số liệu được đánh dấu tạm thời. Có Làm mới và thời gian đồng bộ gần nhất. Kết quả từ kết nối cũ không được ghép vào backend mới. Thư viện server tách khỏi upload cục bộ: bản ghi API không có đối tượng File nên không thể retry upload.

## Quản lý tệp và upload

Tệp của tôi có tab Tất cả / Khu thường / Cần xử lý & Cách ly, bộ lọc loại/kết quả/thời gian, tìm không dấu, list/grid, chọn nhiều, và bảng chi tiết bên phải. Tổng quan có số liệu tổng tệp, đang xử lý, cần chú ý và đã cách ly; số liệu chưa đủ được ghi đang đồng bộ.

Upload chạy tối đa **5 tệp đồng thời**; tệp còn lại chờ. Chuyển trang không ngắt upload. Mỗi tệp có progress/hủy riêng; Hủy tất cả áp dụng những lượt chưa xong. Hủy phía trình duyệt không bảo đảm server chưa ghi nội dung. Đổi kết nối bị khóa khi còn hàng đợi, mỗi tệp ghi nhớ máy chủ ban đầu.

Nút Trải nghiệm / Lưu trữ thật mở menu tại chỗ; chỉ Cài đặt kết nối mới chuyển trang. Ctrl+K/Cmd+K chọn ô tìm kiếm header. Tab di chuyển các điều khiển; Escape đóng menu, panel rồi mới bỏ chọn và trả focus phù hợp.

Chọn tất cả chỉ chọn tệp đang hiển thị trong trang UI; đổi khu/bộ lọc sẽ bỏ lựa chọn. Bỏ khỏi danh sách và Hoàn tác 8 giây chỉ áp dụng upload cục bộ trong phiên, không xóa file hoặc bản ghi server. Cảnh báo trùng dựa tên/kích thước/lastModified trong phiên; không hash nội dung hoặc dò server.

## Upload, Scan và Quarantine độc lập

Endpoints hiện có: POST /upload multipart trường file; GET /health; GET /files?limit=100&cursor=...; GET /files/{id}/status; GET /files/{id}/content?mode=preview|download; PATCH /files/{id}/star. Content/favorites chỉ bật khi health công bố capability tương ứng. Health kiểm cấu hình/client, không chứng minh IAM/storage ghi thành công; scan_status trên health là cấu hình khởi tạo, không phải kết quả từng file. owner_mode=development là định danh phát triển dùng chung, chưa thay thế xác thực/phân quyền từng người dùng.

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

Khu thường gồm not_started/scanning/safe. Khu cần xử lý gồm flagged/quarantined/quarantine_delete_failed/unscanned/error và backend upload failed/unknown. File tự chuyển khu theo trạng thái server. Không upload trực tiếp vào quarantine, xóa server hay khôi phục cách ly trong bản này. Chỉ tệp đã tải lên và có kết quả safe mới được đọc/tải xuống khi backend hỗ trợ.

Bảng chi tiết tách Thông tin và Xử lý; hiển thị findings_count/finding_types/status_reason, thời gian scan/cách ly và cập nhật gần nhất. Phần kỹ thuật chứa ID/key có thể sao chép. Không hiển thị PII nguyên bản, không dựng thời gian hay audit history không có trong API.

Bộ điều phối đồng bộ danh sách định kỳ khi tab hiển thị và có mạng. Poll tệp scanning/flagged hoặc upload chưa xác định, giới hạn **4 status request đồng thời**, backoff khi lỗi và thời gian chờ hữu hạn. Tạm dừng khi tab ẩn/offline, kiểm tra lại khi trở về. Hết thời gian chỉ báo chưa nhận kết quả mới; nút Cập nhật trạng thái chỉ đọc status, không kích hoạt Lambda. Phản hồi cũ không được ghi đè dữ liệu mới hơn.

Danh sách làm mới mỗi 30 giây; status mỗi 3 giây trong phút đầu rồi mỗi 10 giây. Tự theo dõi tối đa 10 phút hoạt động cho mỗi tệp; thời gian tab ẩn/offline không tính vào giới hạn. Lỗi mạng dùng backoff 5–30 giây.

Header X-File-Id/X-File-Key trong lỗi upload hỗ trợ đối soát: nội dung có thể đã lưu nhưng metadata/audit chưa xác nhận. Không tự gửi lại sau timeout hoặc kết quả chưa chắc chắn; kiểm tra trạng thái trước để tránh tạo bản sao.

## Thông báo và tùy chọn

Toast báo upload/scan/cách ly đổi trạng thái, gom thành công gần nhau và tối đa 3 toast. Chuông có Tất cả / Chưa đọc / Cần chú ý, đánh dấu đã đọc và mở đúng tệp. Lần nạp thư viện đầu không phát hàng loạt thông báo cũ; poll cùng trạng thái không tạo lại cảnh báo.

Giữ tối đa 200 thông báo trong phiên. Đây là sự kiện web đã quan sát, không phải audit log đầy đủ. Không xin quyền thông báo hệ điều hành. Refresh xóa thông báo và lịch sử upload cục bộ.

localStorage key maysec.preferences.v2 lưu theme, list/grid, sort, mode, base URL, mật độ hàng, độ rộng cột tên, cột tùy chọn, trạng thái sidebar và bộ lọc đã lưu theo kết nối. Tự đọc/migrate cấu hình v1. Không lưu byte tệp/metadata/history/thông báo. Đánh dấu API yêu cầu persistent_favorites và xác nhận PATCH từ máy chủ, có hoàn tác trạng thái khi lỗi; đánh dấu demo chỉ trong phiên. Mặc định theme Theo hệ thống; áp dụng trước React để tránh chớp nền sai. Khi storage bị chặn/đầy, web vẫn dùng được trong phiên và báo không ghi nhớ tùy chọn.

## Giới hạn nghiệm thu

Unit/UI tests kiểm parser, phân trang, recovery header, ghép bản ghi, trạng thái, polling, notifications, đồng thời, danh sách lớn, bàn phím và hai theme. Browser tests giả lập API không nghiệm thu AWS thật. Cần môi trường S3–DynamoDB–Scan–Quarantine của nhóm thực sự ghi trạng thái/summary để xác nhận cloud. Web không triển khai hoặc gọi trực tiếp Lambda/Step Functions. Dùng dữ liệu nhạy cảm giả khi kiểm tra, không dùng PII thật.

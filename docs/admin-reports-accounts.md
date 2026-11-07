# Thống kê và quản lý tài khoản

Trong thanh điều hướng **Quản trị hệ thống**, admin có thêm **Thống kê** và **Quản trị tài khoản**. Các trang dùng cùng phiên đăng nhập, theme và bố cục hiện có; quyền luôn được kiểm tra tại backend.

Quy tắc phạm vi được dùng chung cho cả Tổng quan bảo mật và Quản trị cách ly: chỉ quản lý dữ liệu của tài khoản có vai trò `user`, loại toàn bộ admin và tài khoản chưa phân quyền. Backend đọc mới directory mỗi request; kiểm tra chủ tài khoản trước khi đọc/tải nội dung, lịch sử, duyệt cách ly hoặc thực hiện thao tác quét. Gọi trực tiếp owner_id của admin trả 403. Mỗi admin vẫn dùng Drive cá nhân với quyền owner-only.

## Thống kê

- Chọn từ ngày / đến ngày (bao gồm cả hai ngày, giờ Việt Nam), người dùng và phạm vi tệp. Có khoảng nhanh 7/30/90 ngày, tối đa 366 ngày. **Đặt lại** trả về 30 ngày gần nhất, tất cả người dùng và tất cả tệp gồm Thùng rác, đồng thời xóa owner trên đường dẫn.
- Thống kê số tệp, dung lượng, tệp có phát hiện, tổng phát hiện, lỗi quét/cách ly, thời gian trích xuất trung bình và số mẫu thực sự có thời gian.
- Biểu đồ và bảng theo ngày tải lên; bảng kết quả xử lý, loại phát hiện, tài khoản và phương thức trích xuất.
- CSV có BOM UTF-8, quoting và chặn công thức từ tên tài khoản. PDF nhúng Noto Sans (OFL), hỗ trợ tiếng Việt, lặp tiêu đề bảng và đánh số trang. Hai định dạng có cùng bộ lọc và cùng các phần số liệu. Web tải bằng `Accept: application/x-ndjson`, dùng chung bộ kiểm tra khung dữ liệu/độ dài/kết thúc với tải tệp hiện có rồi tạo tệp cục bộ; client API khác vẫn có thể nhận CSV/PDF trực tiếp. Bản xuất tổng hợp lại dữ liệu ở thời điểm xuất, có thời gian tạo riêng và ghi audit trước khi trả nội dung.
- Đây là thống kê **tệp đã tải lên còn trong hệ thống và kết quả quét mới nhất**, không phải lịch sử mọi lần chạy pipeline. Thùng rác được tính khi chọn `all` hoặc `trashed`; tệp đã xóa vĩnh viễn và các upload chưa hoàn tất không nằm trong báo cáo. Thời gian là bước trích xuất, không phải độ trễ toàn pipeline.
- Chỉ cộng phân bố theo loại khi số lượng chi tiết khớp tổng phát hiện; tệp thiếu chi tiết được báo riêng. Không xuất giá trị PII, OCR text hay nội dung tệp.
- Đọc trực tiếp từng partition thuộc User Pool, không dùng DynamoDB Scan. Giới hạn 200 trang Query / 20 giây cho một báo cáo; vượt giới hạn trả lỗi và yêu cầu lọc một tài khoản, không trả số liệu tổng hợp dở dang. Có endpoint danh mục tài khoản riêng để vẫn chọn được tài khoản khi phạm vi tổng quá lớn. Các lượt đọc không phải snapshot giao dịch của toàn hệ thống.

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

## API bổ sung

| Method / path | Nội dung |
| --- | --- |
| `GET /admin/accounts?q=&state=all&owner_id=&limit=10&cursor=` | Directory và quota các user trên trang; owner_id lọc chính xác tài khoản đã chọn |
| `GET /admin/accounts/suggestions?q=` | Tối đa 8 user khớp tên/email/username/ID, không trả quota hoặc dữ liệu admin |
| `PATCH /admin/accounts/{sub}/quota` | `limit_bytes`, `revision`, UUID `request_id`, `reason` |
| `PATCH /admin/accounts/{sub}/access` | `role=user`, boolean `enabled`, `revision`, UUID `request_id`, `reason` |
| `GET /admin/accounts/{sub}/history` | 50 sự kiện quản trị mới nhất |
| `GET /admin/reports/owners` | ID/tên để chọn phạm vi báo cáo |
| `GET /admin/reports` | `from_date`, `to_date` dạng YYYY-MM-DD, UUID `owner_id` tùy chọn, `lifecycle=all/active/trashed` |
| `GET /admin/reports/export` | Bộ lọc như báo cáo, thêm `format=csv/pdf` |

Tất cả cần Bearer token vai trò admin. GET và bản xuất đặt `Cache-Control: no-store`. Sai phân quyền trả 401/403; không có tài khoản trong pool trả 404; revision, quota tối thiểu hoặc yêu cầu chờ xung đột trả 409; lỗi kết nối/quyền AWS trả 503. Lỗi xuất không trả một phần nội dung hay bỏ qua audit.

## Cập nhật môi trường đang chạy

1. Đối chiếu [policy backend mẫu](../AWS/IAM/securedrive-cognito-runtime-policy.example.json) với principal backend: bổ sung Cognito `AdminEnableUser`, `AdminDisableUser` đúng User Pool; bổ sung DynamoDB `GetItem` cho `securedrive-users` bên cạnh `UpdateItem` hiện có. GetItem cũng cần để mọi request Cognito kiểm tra trạng thái quản trị. Các quyền files/quota/audit hiện có vẫn cần cho các transaction.
2. Tại `backend`, cài lại `python -m pip install -r requirements.txt` để có ReportLab. Triển khai kèm cả `app/assets/fonts/` và giấy phép OFL; không lấy font từ mạng lúc xuất báo cáo.
3. Khởi động lại backend và build/cập nhật frontend. Không tạo bảng mới, không reset bảng, không chuyển owner hay sửa nội dung tệp để bật chức năng.
4. Nghiệm thu bằng một user thử: đổi quota, thử upload vượt hạn mức, kiểm tra quota sau đăng nhập lại; khóa/mở user; xác nhận tài khoản admin không xuất hiện và gọi trực tiếp API bị chặn; đọc audit; lọc báo cáo một user và tải cả CSV/PDF.

Chế độ Local không Cognito/DynamoDB vẫn dùng quota mặc định. Hai chức năng quản trị cần kết nối Cognito, metadata, hồ sơ và audit; thiếu kết nối sẽ báo rõ thay vì mô phỏng dữ liệu.

Tham chiếu SDK: [Cognito AdminDisableUser](https://docs.aws.amazon.com/boto3/latest/reference/services/cognito-idp/client/admin_disable_user.html).

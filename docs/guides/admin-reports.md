# Hướng dẫn báo cáo quản trị

Mở **Quản trị hệ thống → Thống kê** bằng tài khoản admin. Phạm vi theo [chính sách truy cập](../policies/access-control.md).

## Thống kê

- Chọn từ ngày / đến ngày (bao gồm cả hai ngày, giờ Việt Nam), người dùng và phạm vi tệp. Có khoảng nhanh 7/30/90 ngày, tối đa 366 ngày. **Đặt lại** trả về 30 ngày gần nhất, tất cả người dùng và tất cả tệp gồm Thùng rác, đồng thời xóa owner trên đường dẫn.
- Thống kê số tệp, dung lượng, tệp có phát hiện, tổng phát hiện, lỗi quét/cách ly, thời gian trích xuất trung bình và số mẫu thực sự có thời gian.
- Biểu đồ và bảng theo ngày tải lên; bảng kết quả xử lý, loại phát hiện, tài khoản và phương thức trích xuất.
- CSV có BOM UTF-8, quoting và chặn công thức từ tên tài khoản. PDF nhúng Noto Sans (OFL), hỗ trợ tiếng Việt, lặp tiêu đề bảng và đánh số trang. Hai định dạng có cùng bộ lọc và cùng các phần số liệu. Web tải bằng `Accept: application/x-ndjson`, dùng chung bộ kiểm tra khung dữ liệu/độ dài/kết thúc với tải tệp hiện có rồi tạo tệp cục bộ; client API khác vẫn có thể nhận CSV/PDF trực tiếp. Bản xuất tổng hợp lại dữ liệu ở thời điểm xuất, có thời gian tạo riêng và ghi audit trước khi trả nội dung.
- Đây là thống kê **tệp đã tải lên còn trong hệ thống và kết quả quét mới nhất**, không phải lịch sử mọi lần chạy pipeline. Thùng rác được tính khi chọn `all` hoặc `trashed`; tệp đã xóa vĩnh viễn và các upload chưa hoàn tất không nằm trong báo cáo. Thời gian là bước trích xuất, không phải độ trễ toàn pipeline.
- Chỉ cộng phân bố theo loại khi số lượng chi tiết khớp tổng phát hiện; tệp thiếu chi tiết được báo riêng. Không xuất giá trị PII, OCR text hay nội dung tệp.
- Đọc trực tiếp từng partition thuộc User Pool, không dùng DynamoDB Scan. Giới hạn 200 trang Query / 20 giây cho một báo cáo; vượt giới hạn trả lỗi và yêu cầu lọc một tài khoản, không trả số liệu tổng hợp dở dang. Có endpoint danh mục tài khoản riêng để vẫn chọn được tài khoản khi phạm vi tổng quá lớn. Các lượt đọc không phải snapshot giao dịch của toàn hệ thống.


## API và điều kiện chạy

Các endpoint `/admin/reports/owners`, `/admin/reports`, `/admin/reports/export` được mô tả tại [API](../reference/api.md). Cần Cognito directory, metadata và audit sẵn sàng. Backend cần ReportLab cùng `app/assets/fonts/` và giấy phép OFL để xuất PDF tiếng Việt, không tải font từ mạng lúc xuất. IAM và phát hành tại [triển khai AWS](../operations/aws-deployment.md).

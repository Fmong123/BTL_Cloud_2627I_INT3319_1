# Chính sách quét và cách ly

Nguồn: [Scan](../../AWS/Lambda_AWS/scan_file/handler.py), [Quarantine](../../AWS/Lambda_AWS/quarantine/handler.py), [rescan.py](../../backend/app/services/rescan.py), [quarantine_review.py](../../backend/app/services/quarantine_review.py), [scan_operations.py](../../backend/app/services/scan_operations.py).

## Phạm vi

Scanner tìm CCCD/số thẻ bằng mẫu; không quét mã độc, mật khẩu hoặc API key. Upload 201 chỉ xác nhận lưu nội dung. Không suy safe từ findings_count=0 lúc khởi tạo.

| Nội dung | Cách đọc |
| --- | --- |
| Văn bản được hỗ trợ | Trích xuất trực tiếp |
| PDF có lớp chữ | Parser; mặc định MIN_PDF_TEXT_CHARS=1 |
| PDF scan/mixed, TIFF | Textract bất đồng bộ, đọc đủ phân trang |
| PNG/JPEG | Textract đồng bộ, dùng byte hoặc S3 version phù hợp |
| GIF/WebP | Giải mã PNG trong bộ nhớ, OCR từng khung; mặc định tối đa 50 khung |

Scan mặc định tối đa 100.000.000 byte; OCR ảnh giới hạn đầu vào riêng 10 MiB. Dưới trần upload không bảo đảm đủ thời gian/số trang/định dạng để quét xong. Thiếu parser/decoder, PDF có mật khẩu hoặc OCR lỗi có lý do riêng, không safe. Xem [cấu hình](../reference/configuration.md).

Ảnh xác nhận đủ trang/khung và không có mẫu CCCD/thẻ thì safe, kể cả ảnh không chữ. Không áp suy luận ảnh không chữ cho PDF. Đọc thiếu không safe; phần đã đọc có phát hiện vẫn flagged với extraction_complete=false. Null nghĩa là chưa có bằng chứng đủ.

## Kết quả và báo cáo

| Kết quả | Status metadata |
| --- | --- |
| Chưa nối pipeline | not_started |
| Chờ/đang quét | scanning |
| Đọc đủ, không phát hiện | safe |
| Phát hiện; chờ cách ly hoặc copy lỗi | flagged |
| Copy được, chưa xóa xong nguồn | quarantine_delete_failed |
| Hoàn tất cách ly | quarantined |
| Chưa hỗ trợ/chưa thể đọc đủ theo nhánh xử lý | unscanned |
| Lỗi đọc/xử lý | error |

Báo cáo có số lượng/loại, độ đầy đủ, lý do, thời điểm và thống kê trích xuất; không trả OCR text, giá trị PII hoặc vị trí nội bộ. Thiếu breakdown cũ không suy ra đủ thống kê. SNS lỗi không đổi kết quả quét/cách ly.

## Quét lại và vận hành

Rescan cần active + uploaded, nguồn S3/version hợp lệ và status safe/error/unscanned/not_started. Lượt mới cách tối thiểu 60 giây. Dùng UUID request_id ổn định để xác nhận pending/unknown; không sinh UUID mới vì timeout. Khi nhận, đổi scanning, bỏ summary cũ và chặn execution cũ.

Rescan không giải phóng cách ly. Thử lại copy/xóa và gửi SNS là các thao tác riêng bỏ qua Scan/OCR; xem [phục hồi pipeline](../operations/pipeline-recovery.md). Yêu cầu nén của admin để owner xử lý rồi xác nhận, không tự nén nội dung.

## Xem xét cách ly và restored

Owner gửi lý do xem xét bản active + uploaded + quarantined, không bị pipeline giữ. Admin trong phạm vi user quyết định keep_quarantine hoặc restore, có lý do và audit cùng transaction.

Restore xác minh bucket/key/version cách ly và kích thước. Metadata giữ status=quarantined; quarantine_review.status=restored gắn với version hiện tại khiến API trả scan_status=restored. Owner đọc đúng version cách ly; không copy về nguồn, không tạo upload mới và không biến phát hiện thành safe. Xem [quyền đọc](access-control.md) và [API](../reference/api.md).

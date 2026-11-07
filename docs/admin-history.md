# Lịch sử quản trị

Trang `/admin/history` gom các sự kiện quản trị đã có trong bảng audit. Mục **Lịch sử quản trị** nằm trong menu quản trị; nút lịch sử cạnh từng tài khoản mở cùng trang với bộ lọc tài khoản đã chọn.

## Chức năng

- Lọc theo tài khoản, loại thao tác, kết quả và ngày bắt đầu/kết thúc; mặc định 7 ngày gần đây, tối đa 366 ngày/lượt.
- Tìm không phân biệt dấu theo tên/email/mã tài khoản, tên/mã tệp, tên thao tác hoặc người thực hiện hiển thị.
- Nút **Áp dụng**, **Đặt lại**, **Làm mới**, phân trang trước/tiếp và xem chi tiết sự kiện. Làm mới trở về trang đầu.
- Chi tiết có thời gian Việt Nam, đối tượng, kết quả, lý do và giá trị trước/sau nếu audit có ghi nhận. Có liên kết trở về đúng tài khoản hoặc khu quản trị cách ly.
- Chỉ đọc; không có sửa/xóa lịch sử hoặc gửi lại thao tác từ trang này.

Các nhóm sự kiện: quota và trạng thái tài khoản; đọc/xem xét cách ly; quét lại, yêu cầu nén, đối chiếu và phục hồi pipeline; SNS; xuất thống kê của chính admin đang đăng nhập; cleanup thư mục hết hạn. Các hoạt động cá nhân như upload, đổi tên hay trash thư mục không trở thành sự kiện quản trị chỉ vì chúng cũng có audit.

## Phân quyền và dữ liệu

Mỗi lượt đọc danh sách, trang tiếp hoặc chi tiết đều kiểm tra directory Cognito mới. Chỉ tài khoản đang có quyền admin và còn hoạt động được truy cập. Đối tượng quản trị phải đang có role=user; không đọc lịch sử tài khoản/tệp admin qua trang này. Sự kiện xuất báo cáo nằm dưới chính admin nên chỉ trả bản do admin hiện tại thực hiện, trong phạm vi người dùng hợp lệ. Khi lọc một tài khoản, chỉ trả lần xuất riêng cho tài khoản đó.

Sự kiện một admin khác thao tác trên user hợp lệ vẫn có thể hiện, nhưng người thực hiện được ẩn danh thành “Quản trị viên khác”; không trả ID/tên/email của admin khác. Tệp đã bị purge được tra tên qua lịch sử upload. Cleanup mới lưu tên thư mục vào audit trước khi xóa metadata; bản ghi cũ thiếu tên vẫn có thể hiện là thư mục đã xóa.

API chỉ xuất các trường đã chọn, không trả nguyên `details`, OCR text, giá trị phát hiện, token, S3 key/version hoặc toàn bộ payload AWS. Không thay đổi hoặc tạo lại các audit cũ. Những bản ghi cũ thiếu giá trị trước hoặc lý do hiện **Chưa ghi nhận**, không suy đoán từ trạng thái hiện tại.

Kết quả phản ánh sự kiện tại thời điểm ghi:

- Yêu cầu vừa được lưu/khởi chạy là **Đã ghi nhận yêu cầu**, chưa phải thành công.
- Phục hồi pipeline dựa trên kết quả nghiệp vụ đã đối soát, không chỉ execution xanh.
- SNS `unknown` là **Chưa xác nhận**, tách khỏi thất bại rõ ràng. Xác nhận thủ công được ghi chú là đối chiếu bằng chứng, không chứng minh người nhận đã đọc.
- Đây là các sự kiện đã được audit bởi luồng hiện có, không phải nhật ký mọi HTTP request hoặc mọi lần nhập sai/bị chặn trước khi thay đổi dữ liệu.

## API và vận hành

- `GET /admin/history`: `from_date`, `to_date`, `owner_id`, `category`, `outcome`, `q`, `cursor`, `limit` (1–50, mặc định 20).
- `GET /admin/history/{event_id}`: đọc lại và kiểm tra phạm vi trước khi trả chi tiết.
- Không thêm ENV hoặc bảng. Dùng kết nối và cấu hình bảng audit hiện có.
- Backend cần thêm `dynamodb:Scan` trên bảng `securedrive-audit-log`; policy `AWS/IAM/securedrive-cognito-runtime-policy.example.json` đã cập nhật. Giữ GetItem/Query/PutItem cùng quyền Cognito/metadata hiện có. Không tự cấp IAM, triển khai AWS hoặc sửa ENV thật.
- Hiện đọc audit có giới hạn 200 trang × 100 bản ghi được đánh giá và 20 giây, rồi sắp xếp giảm dần và phân trang. Mã trang giữ bộ lọc, phạm vi quyền, thời điểm chốt và khóa cuối; đổi quyền/bộ lọc phải đọc lại từ đầu. Không trả dữ liệu tổng hợp một phần khi vượt giới hạn hoặc lỗi đọc.
- Với lượng audit vượt giới hạn cần bổ sung chỉ mục theo thời gian. `Scan` vẫn đọc toàn bảng để áp dụng bộ lọc, nên chọn khoảng ngày ngắn không loại bỏ chi phí đánh giá các bản ghi cũ. Không mô tả đây là truy vấn đã tối ưu cho lượng lịch sử lớn.
- Backend và frontend cần phát hành cùng bản. Builder cleanup đóng gói các module backend nên ZIP cleanup được build lại, dù chức năng trang quản trị không chạy trong Lambda.

Handoff chưa được cập nhật trong thay đổi này theo yêu cầu.

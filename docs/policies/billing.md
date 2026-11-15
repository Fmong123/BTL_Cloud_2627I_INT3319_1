# Chính sách chi phí sử dụng

Nguồn chuẩn: [billing-policy.json](../../backend/app/assets/billing-policy.json), được nạp một lần khi backend khởi động; bộ tính phí và API chính sách dùng cùng snapshot. Phiên bản hiện tại `maysec-2026-11-07-v3`. Project demo chỉ ước tính, chưa thanh toán/thu tiền/công nợ; giá trước thuế.

## Đơn giá và phạm vi

| Khoản | Chính sách |
| --- | --- |
| Miễn phí | 1 GB thập phân mỗi user |
| Lưu trữ vượt miễn phí | 5.000 đ/GB/tháng, theo thời gian thực tế sau khi owner bật dùng thử |
| Quản trị bổ sung | 10.000 đ/user/tháng, theo thời gian user được quản lý kể từ lúc được quan sát |
| OCR/quét/mã hóa/thông báo | Đã gộp; phí xử lý cộng thêm bằng 0, giữ giới hạn xử lý hiện có |

Admin không sửa giá qua API. Quota admin cấp riêng không tự bật phí; bật dùng thử chỉ nâng quota mặc định lên 10 GB khi chưa có quota riêng. Miễn phí vẫn 1 GB. Rác/cách ly tính một lần; reservation chưa tính phí. Xem [quota](storage-quota.md).

## Thời gian và làm tròn

- Phí lưu trữ bắt đầu từ mốc upload được xác nhận, không trước mốc kích hoạt theo dõi; ngừng khi xóa vĩnh viễn xác nhận hoàn tất. Không suy diễn mốc cũ từ scan/đổi tên.
- Tại mỗi mốc thay đổi, cộng byte toàn bộ tệp của user rồi trừ 1 GB một lần, tích phân theo thời gian. Không trừ miễn phí từng tệp.
- Kỳ là tháng dương lịch UTC+7, tính đúng số giây/ngày của tháng. Làm tròn phí lưu trữ và phí quản trị từng user rồi cộng; cộng số làm tròn từng ngày có thể lệch vài đồng với số cả tháng.
- Khóa đăng nhập vẫn là được quản lý. Thay nhóm bên ngoài được ghi nhận khi backend quan sát, không đoán ngày đổi nhóm. Backend dừng/mất directory thì không bảo đảm phát hiện trong 60 giây.
- Lưu phí của khoảng user từng được quản lý khi họ đổi vai trò/rời nhóm. Không tính lưu trữ hai lần hoặc nhân phí quản trị theo số admin.
- Dự báo giữ mức hiện tại đến hết tháng, không suy đoán upload/tài khoản tương lai. Lỗi đọc không hiển thị như 0 đồng.
- Giá được ghim theo account/roster. Đổi giá tương lai cần phiên bản và lịch áp dụng/migration; không sửa ngược giá đã lưu của kỳ cũ.

## Cảnh báo và báo cáo

Cảnh báo dung lượng tại 80%, 90%, 100% mức miễn phí; nhảy nhiều mốc chỉ nhắc mức cao nhất. Mở chu kỳ mới sau khi giảm dưới 75% rồi tăng lại.

Ngưỡng tiền áp dụng kỳ hiện tại, nhắc khi dự báo/phát sinh đạt ngưỡng và >0. Ngưỡng 0 nhắc khi phát sinh dương, không phải tắt nhắc. Mỗi loại nhắc một lần theo kỳ/scope/revision; đã nhắc phí phát sinh thì không thêm dự báo thấp hơn. Ngưỡng không chặn phí của dữ liệu đang lưu.

Báo cáo/CSV là ước tính với thời điểm và revision đối chiếu; dữ liệu ghi muộn có thể tạo bản điều chỉnh. Thống kê OCR chỉ dựa trên sự kiện đã ghi nhận, không suy lịch sử cũ hoặc số trang AWS đã tính tiền. Đọc nhiều trang không phải snapshot giao dịch toàn kho.

## Cơ sở định giá

Tỷ giá dự toán cố định 26.000 đ/USD, không phải tỷ giá trực tiếp. Các giá AWS dùng làm giả định nằm trong [snapshot định giá](../reference/aws-pricing-snapshot.md); không cộng lại chúng vào phí MâySec và không coi là cấu hình/hóa đơn cloud thực tế.

Chi tiết ledger/roster/khôi phục, chống trùng cảnh báo và UI tại [thiết kế ghi nhận chi phí](../design/billing.md); endpoint tại [API](../reference/api.md).

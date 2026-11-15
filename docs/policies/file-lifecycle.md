# Chính sách vòng đời tệp và thư mục

Nguồn: [lifecycle.py](../../backend/app/services/lifecycle.py), [folders.py](../../backend/app/services/folders.py), [cleanup](../../AWS/Lambda_AWS/trash_cleanup/handler.py).

## Tệp

`active → trashed → deleting → purged`. Restore từ trashed về active chỉ khi còn hạn và chưa bắt đầu xóa. Upload, quét và vòng đời độc lập.

- Đổi tên chỉ thay tên hiển thị; giữ tên gốc, key, MIME và kết quả quét.
- Di chuyển chỉ thay metadata thư mục, không copy S3 và không đổi quota.
- Thùng rác giữ 30 ngày từ lúc chuyển rác; vẫn tính quota và chặn xem/tải.
- Restore giữ kết quả quét/cách ly. Restore Thùng rác khác quyết định xem xét cách ly.
- Đang upload/unknown/scanning/flagged chờ cách ly hoặc có yêu cầu pipeline đang giữ thì không được chuyển rác.
- Xóa vĩnh viễn chỉ từ rác/đang xóa; xóa mọi version/delete marker thuộc prefix tệp ở nguồn và cách ly.
- Xác minh hết nội dung rồi transaction giữ snapshot lịch sử, đóng mốc chi phí và bỏ metadata sống. Lỗi một phần giữ deleting/quota để retry.
- DELETE lặp lại có snapshot purged vẫn xác nhận thành công. Poll/list cũ không hồi sinh tệp đã có bằng chứng xóa.

## Thư mục

Thư mục là cây metadata theo owner. Cấm tên trùng cùng cha và di chuyển vào chính mình/con cháu. Tên tối đa 120 ký tự sau chuẩn hóa. Di chuyển tối đa 50 tệp/lượt.

Trash thư mục gom cây và tệp active thành nhóm `trash_root_id`. Mục đã ở rác riêng giữ nhóm/thời hạn riêng. Trash/restore cây tối đa **97 thư mục + tệp** mỗi giao dịch; vượt giới hạn trả 409 trước khi ghi.

Restore không hồi sinh mục đã xóa riêng/purged. Cha không còn thì về gốc; tên thư mục trùng thêm hậu tố khôi phục. Tệp restore riêng về gốc nếu thư mục cũ đã purged.

Purge đặt `purging` có kiểm revision trước khi xóa byte. Restore thắng transaction thì purge bỏ qua; purge đã nhận thì chặn restore. Hết tệp mới xóa metadata thư mục, ghi audit/thông báo. Xóa dở giữ trạng thái để tiếp tục.

## Dọn tự động

Cleanup áp dụng cho S3 và nhóm hết `trash_expires_at`, dùng cùng dịch vụ xóa với API. Lịch mẫu mỗi giờ chỉ có hiệu lực khi đã triển khai/bật, không cam kết xóa đúng giây đủ 30 ngày. Không dùng TTL để thay xóa nội dung. Xem [vận hành cleanup](../operations/trash-cleanup.md).

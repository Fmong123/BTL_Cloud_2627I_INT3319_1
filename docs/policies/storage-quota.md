# Chính sách dung lượng và quota

Nguồn: [config.py](../../backend/app/config.py), [quota.py](../../backend/app/services/quota.py), [storage.py](../../backend/app/services/storage.py), [admin_accounts.py](../../backend/app/routers/admin_accounts.py), [billing.py](../../backend/app/services/billing.py).

## Đơn vị và hạn mức

| Đại lượng | Quy tắc |
| --- | --- |
| KB / MB / GB sản phẩm | 1.000 / 1.000.000 / 1.000.000.000 byte |
| Upload mỗi tệp | Tối đa 100.000.000 byte; cấu hình có thể giảm trần |
| Quota mặc định mỗi owner | 1.000.000.000 byte |
| Bật dùng thử chi phí | Cấp mặc định 10 GB nếu chưa có quota riêng do admin đặt |
| Quota admin cấp riêng | 0 đến 10 TB; không giảm dưới `used_bytes + reserved_bytes` |

Mức miễn phí tính phí vẫn là 1 GB, độc lập với quota được cấp. Nâng quota không tự bật tính phí; công cụ ước tính không cấp dung lượng. Multipart SDK dùng MiB nhị phân.

## Cách cộng dung lượng

- `used_bytes`: tệp `uploaded`, kể cả rác, đang xóa hoặc cách ly.
- `reserved_bytes`: đang upload/chưa rõ kết quả; dữ liệu cũ chưa rõ upload state cũng tính bảo thủ. Phần giữ chỗ chưa tính phí lưu trữ.
- `failed` không tính. Timeout/hủy không chứng minh thất bại và không tự giải phóng reservation.
- Bản nguồn/cách ly/các version cùng tệp tính logic một lần. Quota không phải tổng byte vật lý AWS.
- Không cộng partition quota, thư mục, lịch sử, ledger và thông báo vào dung lượng nội dung.
- `available_bytes = max(0, limit_bytes - used_bytes - reserved_bytes)`.
- Chỉ giảm đã dùng sau khi xóa vĩnh viễn hoàn tất nội dung và metadata. Trash/restore không đổi dung lượng.

## Bảo đảm nhận upload

DynamoDB đọc đủ trang nhất quán và trả lỗi dịch vụ khi dung lượng metadata sai. Lease `!quota!<owner> / lock` bảo vệ kiểm quota và reservation; transaction kiểm token để writer hết lease không ghi sau writer mới. Lease mặc định 60 giây, đợi tối đa 4 giây. Vượt quota trả 413; không lấy được lease trả 429.

Thay quota dùng cùng lease với upload, kiểm revision và ghi audit/notification trong transaction. Mọi API worker phải tham gia; writer cũ/ngoài API có thể bỏ qua kiểm quota.

Local dùng khóa SQLite và cộng byte thực tế trong thư mục dữ liệu, giữ kết quả qua restart. Local + DynamoDB phải thỏa cả quota logic và giới hạn vật lý của adapter Local. Local không DB dùng mặc định adapter, không có quota riêng do admin cấp. S3 không có metadata bị từ chối upload với 503.

UI lấy số server khi capability `storage_quota` sẵn sàng; fallback thư viện chỉ tạm tính. Xem [API](../reference/api.md), [dữ liệu](../reference/data-model.md), [chi phí](billing.md).

# Tự dọn Thùng rác sau 30 ngày

Cleanup dùng cùng dịch vụ xóa vĩnh viễn với API thư mục. Không cần thay đổi frontend hoặc thêm bảng dữ liệu.

## Hành vi

- Chỉ dọn tệp S3 và nhóm thư mục đã hết `trash_expires_at`. Thời hạn vẫn là 30 ngày từ lúc đưa vào Thùng rác; thử lại không gia hạn.
- Với thư mục, chỉ xử lý gốc của nhóm `trash_root_id`, kiểm tra cả thư mục con và tệp trong nhóm đều hết hạn. Các tệp/thư mục đã vào rác riêng trước đó giữ thời hạn và quyền khôi phục riêng.
- Đánh dấu gốc `purging` bằng transaction có revision trước khi xóa nội dung. Khôi phục thắng trước transaction thì cleanup bỏ qua; cleanup thắng thì không cho khôi phục giữa lúc đang xóa.
- Xóa mọi version và delete marker tại prefix của từng tệp trong bucket nguồn/cách ly. Chỉ bỏ metadata tệp và giảm quota sau khi xác minh nội dung đã hết; giữ bản ghi lịch sử upload như luồng xóa thủ công.
- Sau khi nhóm không còn tệp, đọc mới cây rồi xóa metadata thư mục bằng một transaction có revision và điều kiện trạng thái, nhóm, thời hạn. Đồng thời ghi audit với actor `lambda:securedrive-trash-cleanup` và thông báo `folder-purged` cho chủ tài khoản. Thông báo vẫn còn khi trình duyệt đang đóng.
- Không dọn `!revision`, lịch sử upload, quota hoặc lịch sử thông báo. Tệp/thư mục đang hoạt động hoặc chưa hết hạn được giữ lại.
- Lỗi S3/DynamoDB giữ phần metadata chưa hoàn tất để thử lại. Nhóm đã bắt đầu xóa giữ `purging`, tránh khôi phục dữ liệu không còn đầy đủ. Ghi audit/thông báo hoặc xóa metadata thư mục lỗi thì transaction không áp dụng một phần.
- Nếu còn dưới 15 giây trước bước tiếp theo, trả `remaining: true`; giữ tiến độ và tiếp tục ở lần chạy sau. Đây là kiểm tra trước mỗi bước, không ngắt một yêu cầu S3 đang chạy. Lỗi thực trả lỗi Lambda để EventBridge áp dụng retry.

Kết quả: `deleted` là số tệp đã xóa trong lần chạy, `folders_deleted` là số bản ghi thư mục đã xóa, `failed` là số mục/nhóm gặp lỗi và `remaining` cho biết đã nhường lượt vì thiếu thời gian. Lịch chạy mỗi giờ nên dữ liệu được dọn ở lần chạy sau khi đủ 30 ngày, không cam kết đúng giây thứ 30 ngày.

Frontend hiện tải lại thư mục khi làm mới hoặc quay lại cửa sổ; thư mục được cleanup sẽ biến mất sau lượt tải lại đó. Không có nút mới và không thay đổi thời hạn khôi phục.

## Cập nhật AWS

1. Upload `AWS/build/securedrive-trash-cleanup.zip` đã build từ source mới, runtime Python 3.12, handler `handler.lambda_handler`. Không cần thêm FastAPI/Pydantic hoặc layer API: handler chỉ import các module dịch vụ dùng Python chuẩn và SDK boto3 có trên Lambda.
2. Env: `UPLOAD_BUCKET`, `QUARANTINE_BUCKET` đúng bucket hiện tại; `FILES_TABLE=securedrive-files`, `AUDIT_TABLE=securedrive-audit-log` mặc định. Nếu tên bảng khác, đặt biến tương ứng. `AWS_REGION` do Lambda cung cấp; không đặt credentials/profile trong env.
3. Cập nhật role theo `AWS/IAM/securedrive-trash-cleanup-policy.example.json`: thêm `dynamodb:Query` trên files và `dynamodb:PutItem` trên audit, giữ quyền files Scan/GetItem/UpdateItem/PutItem/DeleteItem, S3 ListBucketVersions/DeleteObject/DeleteObjectVersion và Logs. Transaction dùng quyền thành phần; không có IAM action `dynamodb:TransactWriteItems`. Không cần quyền Cognito hoặc SNS.
4. Giữ lịch ở `DISABLED` trong lúc nghiệm thu. Dùng dữ liệu thử: thư mục rỗng hết hạn; cây có tệp nguồn/cách ly; nhóm chưa hết hạn; xóa lỗi rồi retry; khôi phục đồng thời. Kiểm tra S3, quota, lịch sử, audit và chuông thông báo trước khi bật lịch mỗi giờ.

Không bật DynamoDB TTL trên metadata thư mục/tệp để thay cho cleanup: TTL có thể bỏ bản ghi trước khi xóa xong nội dung. Thay đổi source này không tự triển khai hoặc bật lịch AWS.

## Kiểm chứng local — 06/11/2026

265 kiểm thử backend qua, gồm 11 ca mới về cleanup thư mục và phụ thuộc Lambda. Luồng trình duyệt thư mục qua với Chrome + API/Moto local: tạo/cấp con/đổi tên/di chuyển, kéo thả, upload, trash/restore cả cây, mobile và dark mode. Các ca cleanup gồm xóa mọi version nguồn/cách ly, quota/lịch sử/audit/thông báo, phân trang, giữ nhóm chưa hết hạn, phục hồi đồng thời, lỗi lưu trữ/audit, nhường lượt và thử lại.

Bốn ZIP đã kiểm khớp source. ZIP cleanup đã kiểm cú pháp Python 3.12 và import trực tiếp khi chặn các dependency API; đây chưa phải chạy thử trên runtime AWS thật. Bộ kiểm thử và builder vẫn giữ local theo chính sách repository.

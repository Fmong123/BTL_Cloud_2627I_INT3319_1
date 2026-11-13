# Xử lý riêng bước cách ly và đối soát thông báo

Admin mở **Tổng quan bảo mật → Vận hành quét → Xem chi tiết → Kết quả kiểm tra**, hoặc mở chi tiết trong Quản trị cách ly. Phần **Xử lý cách ly và thông báo** dùng cùng dialog, API Bearer, phạm vi tài khoản user và lịch sử tệp hiện có. User không gọi API quản trị; admin không xử lý tệp của admin khác, kể cả chính admin qua khu quản trị.

## Cách dùng

- Cách ly lần đầu chạy tự động sau khi quét phát hiện dữ liệu nhạy cảm. Nếu lượt chạy đã kết thúc mà metadata vẫn chờ cách ly, **Kiểm tra kết quả** đối chiếu thời điểm dừng, ghi nhận cách ly chưa hoàn tất và đổi nhãn sang thất bại. Thao tác này không tự tạo lượt cách ly mới. Admin dùng **Thử lại cách ly** để yêu cầu chạy lại sau khi xử lý nguyên nhân lỗi; kết quả quét và quyền xem/tải vẫn được giữ nguyên.
- **Thử lại cách ly**: áp dụng cho flagged/quarantine_delete_failed còn active và upload xong. Nhập lý do, xác nhận. Workflow bỏ qua Scan/OCR, gọi đúng bộ cách ly: kiểm tra bản nguồn và bản cách ly cùng version, dùng lại bản sao đã xác minh trước khi thử xóa nguồn. Không đổi kết quả phát hiện hoặc quota. Khi gửi yêu cầu thành công, UI hiển thị đang chờ kiểm tra kết quả; chỉ xác nhận hoàn tất sau khi đối chiếu workflow và metadata.
- **Gửi thông báo / Gửi lại**: chỉ gửi qua SNS/email. Lần gửi SNS đã sent không gửi lại. `not_recorded` nghĩa là chưa có bằng chứng trong metadata, có thể do kênh chưa cấu hình, không tự kết luận gửi lỗi. SNS chưa cấu hình không được báo thành công.
- **Kiểm tra kết quả**: đọc lại metadata/bằng chứng gửi và DescribeExecution của workflow. Nếu yêu cầu khởi chạy chưa rõ và AWS chưa có execution, thử xác nhận bằng đúng tên/input/request ID đã lưu. Nếu đang chạy thì tiếp tục giữ trạng thái chờ. Nếu đã kết thúc, đối chiếu kết quả thực tế rồi ghi audit và nhả khóa. Một execution SUCCEEDED không tự chứng minh đã gửi email nếu metadata chưa có bằng chứng kênh tương ứng.
- **Xác nhận theo bằng chứng**: chỉ dành cho lần gửi SNS sending/unknown. Admin nhập UUID Message ID SNS, tham chiếu bằng chứng đã đối chiếu và lý do. Đây là xác nhận thủ công của admin, có tác nhân/thời điểm; không phải việc backend tự xác thực Message ID với SNS hoặc tự đọc CloudWatch. Không nhập token, thông tin bí mật hoặc nội dung tài liệu vào bằng chứng.
- **Gửi lại khi chưa rõ**: phải đánh dấu xác nhận nguy cơ gửi trùng và nhập lý do. Hệ thống không tự biến unknown thành chưa gửi, không tự gửi lại và không tự suy ra người nhận đã nhận/đọc thông báo.

Sau thử lại cách ly, admin có thể gửi thông báo kết quả qua SNS/email khi cần. Nhánh phục hồi cách ly không tự gửi SNS/email. Khi admin đối chiếu thành công hoặc thất bại của bước cách ly, chủ tệp nhận thông báo trong ứng dụng và tiếp tục xem trạng thái/lịch sử theo quyền.

## Đồng thời và kết quả chưa rõ

- Yêu cầu được lưu vào metadata cùng audit bằng transaction **trước** StartExecution. Request ID và input ổn định; response HTTP bị mất không tạo lượt mới. UI giữ ID khi thử lại; reload vẫn có yêu cầu đang giữ trong metadata để kiểm tra.
- `pipeline_busy` chặn trash tệp/cây thư mục, rescan và thay đổi yêu cầu xem xét cách ly. Các transaction kiểm tra điều kiện này để chặn cả request đã đọc metadata trước khi yêu cầu phục hồi được nhận. Đổi tên/di chuyển không đổi key hoặc version của nội dung.
- Phải xác nhận execution trước đã kết thúc trong workflow STANDARD đã cấu hình. Với FAILED/TIMED_OUT/ABORTED, chờ thêm 960 giây từ stopDate để Lambda đồng bộ cũ có thời gian kết thúc; RUNNING/PENDING_REDRIVE hoặc thiếu bằng chứng thì từ chối. Khoảng chờ được tính từ lần dừng trên AWS, không tính từ lúc bấm nút.
- Claim thay execution_id sang lượt mới và thêm pipeline_request_id để Lambda cũ bị chặn, kể cả tệp chưa từng rescan. Worker cách ly có claim riêng chống copy/delete đồng thời; gửi thông báo vẫn dùng token/state có điều kiện. Nhánh phục hồi không cấu hình tự retry toàn Task.
- Nếu StartExecution/ghi xác nhận bị timeout, request vẫn giữ busy; admin dùng Kiểm tra kết quả, không xóa khóa hoặc chỉnh DynamoDB thủ công. Lỗi audit trước claim không chạy bước ngoài AWS. Lỗi một phần không mở quyền đọc tệp hoặc giảm quota.
- Tệp legacy thiếu execution/version hoặc thuộc workflow khác được từ chối với lý do cụ thể; không tự đoán vị trí S3 hay kết quả gửi.

## API

| Method/path FastAPI | Nội dung |
| --- | --- |
| GET /admin/files/{id}/pipeline?owner_id=UUID | Snapshot revision, cấu hình, trạng thái cách ly, bằng chứng SNS và yêu cầu phục hồi gần nhất; không ghi dữ liệu |
| POST /admin/files/{id}/pipeline?owner_id=UUID | Thao tác có phân quyền; trả message và snapshot mới |

POST nhận `action=check/retry_quarantine/retry_notification/confirm_sent`, UUID `request_id`, `revision` SHA-256 từ snapshot. Các thao tác thay đổi cần `reason` 3–300 ký tự. Thông báo cần `channel=sns`; confirm_sent cần `receipt` và `evidence`; retry kênh chưa rõ cần `allow_duplicate=true`. Không nhận bucket/key/ARN từ browser. Không trả token giao nhận hay văn bản tài liệu. Snapshot cũ trả 409; tham số sai 422; cấu hình/dịch vụ chưa xác minh trả 503; admin target ngoài phạm vi trả 403.

Lịch sử admin hiển thị action/channel/lý do/kết quả/tham chiếu bằng chứng của ba sự kiện admin_pipeline_requested, admin_pipeline_checked và admin_notification_confirmed. Các trường được whitelist riêng; API lịch sử cá nhân tiếp tục không trả details nội bộ. Không cần bảng, GSI hoặc chuyển dữ liệu cũ.

## Triển khai đồng bộ

### Ngừng webhook (06/11/2026)

Giao diện, API và Lambda Notify chỉ hỗ trợ SNS/email. API từ chối `channel=webhook` với 422; Lambda cũng từ chối sự kiện phục hồi kênh cũ trước khi gửi. Luồng quét và cách ly thông thường tiếp tục gửi SNS, không gọi HTTP webhook. Thông báo trong ứng dụng giữ nguyên.

Không xóa các trường `notify_*_webhook_*` hoặc audit cũ. Chúng chỉ còn là lịch sử, không tạo cảnh báo cần gửi lại. Yêu cầu phục hồi webhook đang giữ khóa chỉ được kiểm tra, không khởi chạy lại: nếu execution còn chạy thì tiếp tục chờ; nếu đã kết thúc thì xác minh khoảng chờ an toàn hiện có; nếu AWS chưa có execution thì phải chờ ít nhất 960 giây từ requested_at. Sau đó ghi audit `retired` và nhả khóa, không đánh dấu thông báo đã gửi hoặc chuyển nó sang SNS. Thiếu bằng chứng/thời điểm hợp lệ thì giữ khóa và báo lỗi cụ thể.

Khi triển khai, cập nhật Lambda Notify cùng backend/frontend. Biến `WEBHOOK_URL` cũ không còn được đọc; có thể xóa khỏi cấu hình Lambda lúc cập nhật. Không cần chuyển dữ liệu hay thay SNS_TOPIC_ARN. Các bước dưới đây là hướng dẫn triển khai, thay đổi source local không tự cập nhật AWS.

1. Build lại bốn ZIP bằng builder local và kiểm tra `--check`. Cập nhật ba Lambda Scan/Quarantine/Notify **cùng pipeline_common.py mới**; cập nhật Cleanup vì dùng module lifecycle mới. Giữ env, layer, IAM, bucket và KMS đang có.
2. Cập nhật workflow STANDARD hiện có bằng `AWS/Orchestration/State_machine.json`: StartAt=RouteOperation; có RecoveryQuarantine/RecoveryNotify; sự kiện upload thông thường vẫn đi vào ScanFilePII. Hai nhánh phục hồi gọi Lambda đồng bộ, timeout Task=1000 giây. Giữ Lambda đồng bộ tối đa 900 giây; không thay sang invoke async. Không cần tạo workflow mới hoặc cấp quyền invoke Lambda cho backend.
   Bản sửa 13/11/2026 thêm PersistQuarantineFailure để ghi trạng thái và audit trực tiếp khi Lambda ghi lỗi cũng không chạy được. Role Step Functions phải có quyền trong AWS/IAM/securedrive-sfn-dynamodb-policy.json trước khi áp dụng workflow. Giữ quyền Lambda riêng; không cấp quyền copy/xóa S3 cho workflow. Lỗi bucket/KMS ở phần chuẩn bị Lambda cách ly cũng được lưu lý do và thông báo thất bại.
3. Backend dùng ARN `MAYSEC_RESCAN_STATE_MACHINE_ARN` và cờ pipeline hiện có. Cần DescribeStateMachine/StartExecution và DescribeExecution trên workflow/execution tương ứng, cùng quyền files/audit hiện hành. Backend kiểm tra cấu trúc workflow trước khi nhận yêu cầu mới và báo 503 nếu chưa cập nhật. `/health` hoặc nút cấu hình không chứng minh IAM/Lambda/workflow đã nghiệm thu.
4. Cập nhật backend và frontend cùng phiên bản, restart backend và refresh trình duyệt. Khi chưa cấu hình workflow, UI vẫn cho xem trạng thái nhưng khóa nút gửi yêu cầu mới. Không có biến môi trường mới, không reset bảng/quota/tệp.
5. Nghiệm thu cloud bằng dữ liệu thử: lỗi copy, lỗi xóa nguồn, kênh thất bại rõ ràng, timeout chưa rõ, gửi lại SNS, audit và admin target bị chặn. Đối chiếu version/checksum workflow/Lambda trước khi bật sử dụng. Mã nguồn và kiểm thử local không tự triển khai AWS.

Kiểm tra local: pytest toàn bộ backend; `npm run test:ui:pipeline` dùng Chrome, Moto, HTTP FastAPI và các handler Lambda thật trong source với sender giả lập. Không gửi SNS thật. Các test/script vẫn chỉ giữ local theo chính sách hiện tại của repo.

Tham chiếu: [StartExecution và idempotency STANDARD](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartExecution.html), [timeout Lambda đồng bộ](https://docs.aws.amazon.com/lambda/latest/dg/configuration-timeout.html), [giới hạn timeout theo kiểu invoke](https://aws.amazon.com/about-aws/whats-new/2026/09/aws-lambda-90-minute-function/).

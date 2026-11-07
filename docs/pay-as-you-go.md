# Chính sách và theo dõi chi phí theo sử dụng

Phạm vi: project demo, không chia doanh nghiệp, không thanh toán/thu tiền/công nợ. Một nguồn chính sách chỉ đọc tại `backend/app/assets/billing-policy.json`; admin không có API sửa giá. Phiên bản `maysec-2026-11-07-v3` bổ sung đối chiếu theo phiên bản, khôi phục thống kê và làm tròn thống nhất; không đổi đơn giá. Các mức giá là đề xuất dự toán trước thuế, không phải tiền đã thu hay hóa đơn AWS.

Chính sách được nạp một lần khi backend khởi động; API bảng giá và bộ tính tiền dùng cùng snapshot. Khi bên phát triển cập nhật chính sách phải cập nhật phiên bản, xử lý lịch áp dụng cho account cũ và khởi động lại backend; không chỉ sửa giá frontend.

## Điều hướng và trải nghiệm

- `/pricing`: Chính sách & bảng giá ở cạnh Cài đặt, Hướng dẫn. Bao gồm giá dịch vụ, quy tắc, công cụ tính thử và một ghi chú ngắn về cơ sở định giá; không hiển thị bảng đơn giá AWS trên giao diện.
- `/costs`: user theo dõi sử dụng, phí đã phát sinh, dự báo, chọn tháng, xác nhận dùng thử, ngưỡng cảnh báo và CSV theo ngày.
- `/admin/costs`: Lối tắt của admin, tổng phí lưu trữ user + phí quản trị bổ sung, chi tiết từng user, dự báo, CSV, ngưỡng cảnh báo. Có thống kê user phát sinh phí, phí lưu trữ bình quân, dự báo lưu trữ cuối kỳ, biểu đồ chi phí theo các khoảng 7 ngày và top 5 user theo phí lưu trữ. Không tính phí lưu trữ lần thứ hai, không nhân phí khi có nhiều admin.
- Bộ lọc kỳ chi phí dùng tháng/năm bằng số (ví dụ `11 / 2026`), không dùng ô tháng native có tên tháng phụ thuộc ngôn ngữ trình duyệt. Cùng kỳ được áp dụng cho tổng quan, thống kê, chi tiết và CSV.
- Dùng font, size và token màu chung của ứng dụng, bảng và modal hiện có; sáng/tối và mobile. Bảng user thành danh sách trên màn hình nhỏ.
- Bản đọc chính sách có phần hạn mức lưu trữ, quy tắc chung và phần riêng cho user/admin. Sau khi bật, mặc định **10 GB tổng dung lượng = 1 GB miễn phí + tối đa 9 GB vượt mức**; hạn mức admin đã cấp riêng được giữ. Không đủ chỗ kể cả phần đang giữ chỗ thì chặn upload vượt hạn mức. Công cụ ước tính không cấp thêm quota; quota cao hơn không tự bật tính phí.
- Công cụ ước tính đặt trước phần hạn mức. Trang chính sách tóm tắt bằng thanh chia dung lượng miễn phí/vượt mức, công thức tính, ba bước ghi nhận và thẻ thông tin user/admin; toàn bộ quy định vẫn giữ trong mục mở rộng “Đọc đầy đủ chính sách và các trường hợp áp dụng”.
- Có thống kê lượt quét, lượt OCR, trang OCR đã trích xuất và lỗi/chưa hỗ trợ theo kỳ; phí xử lý cộng thêm luôn 0 vì đã gộp. Chỉ đếm các kết quả mới được ghi nhận sau cập nhật, không suy đoán lịch sử cũ hoặc số trang AWS tính tiền. Tiếp tục giới hạn định dạng/kích thước hiện có và khoảng cách quét lại tối thiểu 60 giây.

## Giá và nguồn AWS

Mỗi user được miễn phí 1 GB thập phân. Phí lưu trữ vượt mức: **5.000 đ/GB/tháng**, theo thời gian thực tế sau khi chủ tài khoản bật theo dõi. Phí quản trị bổ sung: **10.000 đ/user/tháng**, theo thời gian user được quản lý kể từ lúc chức năng bắt đầu quan sát. Tài khoản bị khóa vẫn được quản lý; không tính theo số lần đăng nhập. OCR/quét/mã hóa/thông báo gộp trong dịch vụ, vẫn theo giới hạn xử lý hiện có; không thêm phí theo trang. Không áp một hạn mức OCR 100 trang chỉ vì mockup trước có số minh họa đó.

Giá tham chiếu Sydney đọc từ AWS Price List công khai ngày 07/11/2026, catalogue công bố từ 20/10 đến 05/11/2026. Snapshot JSON có URL catalogue, usage type, ngày công bố và đơn vị để đối chiếu từng dòng. Ví dụ:

| Dịch vụ | USD |
| --- | ---: |
| S3 Standard, 50 TB đầu | 0,025/GB/tháng |
| S3 PUT/COPY/POST/LIST | 0,0055/1.000 request |
| S3 GET | 0,00044/1.000 request |
| Textract Detect Document Text | 0,0015/trang, triệu trang đầu |
| Lambda x86 | 0,0000166667/GB-giây; 0,20/triệu request |
| Step Functions Standard | 0,025/1.000 chuyển trạng thái |
| DynamoDB Standard on-demand | 0,71/triệu WRU; 0,1425/triệu RRU |
| KMS customer managed key | 1/khóa/tháng; 0,03/10.000 request đối xứng |
| CloudWatch Logs Standard | 0,67/GB ingest; 0,033/GB/tháng lưu |
| Cognito Essentials (giả định tier) | 0,015/MAU |
| Internet data transfer out Sydney | 0,114/GB, 10 TB đầu sau mức miễn phí toàn cục |
| EC2 t3.micro Linux On-Demand, cấu hình tham chiếu | 0,0132/giờ |
| EBS gp3 provisioned storage | 0,096/GB/tháng |

Các giá miễn phí AWS/credit không được dùng để cam kết giá lâu dài. Nguồn chính: [S3](https://aws.amazon.com/s3/pricing/), [Textract](https://aws.amazon.com/textract/pricing/), [Lambda](https://aws.amazon.com/lambda/pricing/), [Step Functions](https://aws.amazon.com/step-functions/pricing/), [DynamoDB](https://aws.amazon.com/dynamodb/pricing/on-demand/), [KMS](https://aws.amazon.com/kms/pricing/), [CloudWatch](https://aws.amazon.com/cloudwatch/pricing/), [Cognito](https://aws.amazon.com/cognito/pricing/).

Tỷ giá dự toán cố định **26.000 đ/USD**, không phải tỷ giá trực tiếp. Mỗi GB logic/tháng giả định 1,25 GB vật lý, OCR 40 trang, outbound 0,25 GB và 0,004 USD dự phòng request/pipeline: 3.217,5 đ; cộng dự phòng 30% thành 4.182,75 đ, làm tròn giá đề xuất 5.000 đ. Phí quản trị dự toán từ Cognito, read/write, log và phân bổ vận hành; toàn bộ phép tính có trong JSON và trang chính sách.

Chưa xác nhận instance EC2, EBS, tier Cognito, Route 53/tên miền hoặc tải thực tế. Bảng liệt kê IPv4/DNS khi áp dụng; không tự gán cấu hình EC2 hoặc bảo đảm đủ bù chi phí cố định khi ít user. Giả định OCR/lưu lượng dùng để định giá, không phải lượng AWS đã đo và không phải hạn mức mới. Không cộng các dòng AWS lần nữa vào phí MâySec.

Cấu hình tham chiếu riêng: EC2 t3.micro Linux chạy 730 giờ + 20 GB gp3 + 1 IPv4 + 1 khóa KMS + 1 hosted zone = 16,706 USD, khoảng **434.356 đ/tháng** theo tỷ giá dự toán. Đây không phải xác nhận cấu hình hiện tại và chưa gồm CPU credit, DNS query, tên miền, request, OCR, lưu trữ S3 và truyền dữ liệu. Đơn giá EC2/EBS được đọc bằng streaming catalogue AWS công khai; URL và ngày công bố được giữ trong snapshot.

## Ghi nhận và tính phí

- `!quota!<owner> / billing` lưu mốc theo dõi bền vững, trạng thái bật dùng thử, đơn giá/phiên bản đã áp dụng và ngưỡng cảnh báo. Được khởi tạo khi đồng bộ hồ sơ/directory, đối chiếu định kỳ hoặc đọc dung lượng/chi phí lần đầu; không lấy thời điểm scan/đổi tên để suy diễn lịch sử cũ.
- `billing_uploaded_at` đặt bằng `if_not_exists` cùng lần xác nhận upload thành công; retry không dời mốc. Tệp failed/pending/unknown chỉ giữ chỗ, không tính phí lưu trữ.
- Xóa vĩnh viễn giữ `billing_uploaded_at` và `billing_deleted_at` trong snapshot `!history!<owner>` cùng transaction xóa metadata. Cleanup dùng cùng FileLifecycle nên áp dụng cả xóa tự động; chỉ dừng sau khi xác nhận xóa nội dung/metadata. Snapshot không được TTL/xóa nếu còn cần lịch sử chi phí.
- `!quota!<owner> / billing-file-<id>` chứa số byte, mốc bắt đầu/kết thúc và bản thống kê an toàn cần bổ sung nếu purge khi đang chờ đối chiếu. Được ghi cùng transaction xác nhận upload và đóng cùng transaction purge; retry không dời mốc. Tệp cũ được bổ sung sổ này khi còn trong phạm vi được phép đọc. Khi user đổi vai trò/rời nhóm, admin chỉ dùng sổ tài chính trong các khoảng được quản lý, không truy cập tệp/Thùng rác/nội dung riêng của người đó.
- Kỳ đã kết thúc lưu bản đối chiếu chỉ số tài chính tại `!quota!<UUID zero> / billing-period-YYYY-MM`, nén JSON để giữ nhỏ. Mỗi lượt xem đối chiếu lại sổ tài chính; nếu dữ liệu hoặc trạng thái thay đổi, tăng `report_revision`, giữ bản trước ở `billing-period-YYYY-MM-rN` cùng transaction có lease. Fingerprint bỏ thời gian kiểm tra để không tạo phiên bản khi dữ liệu giống nhau; lượt tính cũ không ghi đè phiên bản mới. Năm phút đầu sau kết thúc kỳ hoặc có bản ghi cần bổ sung hiện `reconciling`, sau đó `reconciled`; dữ liệu ghi muộn vẫn tạo phiên bản điều chỉnh mới. CSV có số phiên bản/trạng thái. `as_of` là lúc tạo bản; `checked_at` là lần kiểm tra gần nhất nếu không đổi bản. Đây vẫn là báo cáo ước tính, chưa phải hệ thống hóa đơn.
- Sweep toàn bộ khoảng tồn tại của các tệp, cộng tổng byte tại mỗi mốc rồi trừ 1 GB **một lần cho mỗi user**. Không trừ miễn phí từng tệp. Rác/cách ly tính một lần; bản sao nội bộ không cộng.
- Mỗi kỳ theo tháng dương lịch ở UTC+7, dùng đúng số giây và số ngày của tháng. Phí lưu trữ làm tròn cuối phép tính của mỗi user; phí quản trị cũng làm tròn từng user rồi cộng tổng, vì vậy tổng quản trị và tổng bảng kê khớp các dòng. Dự báo tổng bằng cộng dự báo từng user. Chi phí lưu trữ từng ngày làm tròn riêng để hiển thị nên cộng các ngày có thể lệch vài đồng với phí lưu trữ cả kỳ.
- Bật dùng thử dùng lease quota và transaction. Chưa có quota riêng thì cấp mặc định 10 GB; có quota admin đặt thì giữ nguyên. Không bật tự động hoặc tính ngược trước khi xác nhận. Retry không thay đổi mốc bắt đầu.
- Đơn giá được ghim theo account/roster; đổi phiên bản giá tương lai cần migration/lịch hiệu lực do bên phát triển thiết kế, không sửa trực tiếp giá đã lưu hoặc tính lại kỳ cũ.
- Admin dùng roster chung `!quota!00000000-0000-0000-0000-000000000000 / billing-roster`; lưu khoảng được quản lý, chống tạo trùng khi nhiều admin đọc. Đồng bộ khi đăng nhập/hồ sơ/danh sách demo và qua worker đối chiếu directory khoảng mỗi 60 giây khi backend hoạt động; không cần mở trang Chi phí. User mới bắt đầu từ lúc được quan sát có role=user; không dùng ngày Cognito tạo tài khoản vì đó có thể là tài khoản admin cũ mới chuyển vai trò. Không đoán ngày đổi nhóm/rời nhóm bên ngoài ứng dụng: đóng/mở khoảng tại lần phát hiện tiếp theo. Khóa đăng nhập không phải gỡ khỏi quản lý. Khi backend dừng hoặc mất kết nối, không cam kết phát hiện thay đổi trong 60 giây.
- Nếu user rời danh sách hiện tại, cả phần lưu trữ và quản trị trong thời gian được quản lý vẫn được giữ. Thống kê, biểu đồ, chi tiết và CSV đều dùng số liệu này. Bản tổng hợp tháng cũ không chứa dung lượng hiện tại hoặc nội dung riêng của tài khoản đã đổi vai trò.
- Dự báo giữ nguyên mức hiện tại tới hết tháng, không suy đoán user mới hay upload tương lai. Các lượt query nhất quán từng trang nhưng không phải snapshot giao dịch toàn kho; báo cáo có thời điểm đối chiếu và tải lại. Không hiển thị 0 khi đọc dữ liệu thất bại.

### Khôi phục thống kê và trạng thái đối chiếu

- Lambda lưu `billing_processing_record` và `billing_usage_pending` cùng kết quả quét. Audit bắt buộc chứa bản ghi thống kê này; ghi `billing-scan-*` là best effort, lỗi quyền/mạng không chặn kết quả quét, bước cách ly hoặc thông báo. Replay audit cũ không bổ sung trường vào payload cũ để tránh xung đột.
- Backend phục hồi bản ghi còn thiếu từ kết quả đã lưu và audit, chống trùng bằng ID sự kiện. Nhiều lần quét trong khi thống kê lỗi đều được phục hồi. Purge giữ bản ghi đang chờ trong sổ tài chính cùng transaction xóa metadata; không cần chạy lại OCR. Tài khoản rời nhóm chỉ được đối chiếu số liệu trong khoảng được quản lý, không đọc nội dung/tệp riêng sau khi đổi vai trò.
- `ledger_ready` đánh dấu hoàn thành chuyển dữ liệu cũ. Các lượt đọc thông thường không query toàn bộ lịch sử đã xóa hoặc Put có điều kiện cho từng tệp; chỉ bổ sung tệp đang tồn tại nếu thiếu bản ghi. Dữ liệu sổ tài chính được đọc một lần và dùng chung cho tích phân phí/thống kê; danh sách đang lưu dùng chung để tính quota và cảnh báo.
- Trang chi phí admin có **Đối chiếu tự động**, lần thử gần nhất, lần thành công gần nhất và nút **Đối chiếu ngay**. Trạng thái phân biệt chờ, đang chạy, thành công, có mục cần thử lại, lỗi và chậm quá 180 giây. Một tài khoản lỗi không làm bỏ qua các tài khoản còn lại. Trạng thái bền vững nằm tại `!quota!<UUID zero> / billing-reconciliation`; lease riêng `billing-monitor-lock` chống nhiều worker/nút thủ công chạy trùng. Không ghi nguyên lỗi AWS vào giao diện.
- Chọn tháng đã kết thúc rồi **Xem lịch sử đối chiếu** để xem các bản mới/cũ, thời điểm ghi nhận, tổng lưu trữ, tổng quản trị và số lượt OCR. API trả tối đa 5 bản/lượt và có phân trang; không trả nội dung tệp hoặc dữ liệu ngoài tài chính. CSV ghi phiên bản, tổng bản trước và mức điều chỉnh nếu có.
- `/health` chỉ công khai trạng thái tổng quát và có bật worker hay không; chi tiết chỉ dành cho admin được kiểm tra lại vai trò từ directory. Đối chiếu thủ công có audit trong nhóm Chi phí & chính sách. Khi backend tắt hoặc thiếu directory, không cam kết chạy nền mỗi 60 giây.

## Cảnh báo

Phần Cảnh báo chi phí hiển thị riêng ngưỡng hiện tại đã lưu và ô nhập ngưỡng mới. Chỉ cập nhật mức đang áp dụng sau khi backend xác nhận thành công, kèm thông báo ngay tại phần này ghi rõ ngưỡng mới và ngưỡng trước đó. Lưu dùng revision + request UUID, cùng lease với kích hoạt; phiên cũ nhận 409, retry cùng request không tạo lại audit. Giao diện không nhận dữ liệu polling có revision thấp hơn ngưỡng vừa xác nhận và giữ bản nháp đang sửa. Khi chưa xác nhận được lần lưu, tiếp tục hiển thị giá trị đã xác nhận gần nhất và hướng dẫn cập nhật để đối chiếu.

Thanh dung lượng có nhắc gần hết miễn phí; server lưu thông báo ở mốc 80%, 90%, 100% qua chuông hiện có. Nếu nhảy qua nhiều mốc, chỉ gửi mức cao nhất. Marker `!quota!<owner> / billing-alerts` và notification được ghi cùng transaction, không gửi lại khi refresh/retry. Chỉ mở chu kỳ cảnh báo mới khi đã giảm dưới 75% rồi tăng lại. Kiểm tra ngay sau xác nhận upload, khi đọc và trong worker. Lỗi ghi thông báo không làm mất upload/quota; lần đối chiếu tiếp theo thử lại.

Ngưỡng tiền dùng cho kỳ hiện tại: gửi vào chuông khi dự báo hoặc phí phát sinh **đạt** ngưỡng và số tiền > 0. Marker theo kỳ, scope user/admin và revision ngưỡng, cùng transaction với thông báo. Mỗi loại dự báo/phát sinh chỉ nhắc một lần; nếu phí phát sinh đã đạt trước thì không gửi thêm cảnh báo dự báo thấp hơn. Ngưỡng 0 nhắc khi có chi phí dương, không tự tắt nhắc. Thông báo user mở `/costs`, admin mở `/admin/costs`. Không chặn phí dữ liệu đang lưu; trạng thái đã đọc dùng chung chức năng thông báo hiện có.

Nhật ký ghi bật tính phí (kèm chính sách/hạn mức), đổi ngưỡng (trước/sau) và xuất CSV. Nhóm **Chi phí & chính sách** trong Lịch sử quản trị hiển thị hoạt động user thuộc phạm vi và hoạt động của chính admin. Không lộ lịch sử chi phí cá nhân của admin khác. CSV được tạo tại backend, kiểm tra quyền mới, ghi audit thành công trước khi trả; hủy tải khi đổi tài khoản/đổi kỳ.

## API và triển khai đồng bộ

| API | Quyền / nội dung |
| --- | --- |
| GET /billing/policy | Đăng nhập; chính sách chỉ đọc |
| GET /billing/usage?month=YYYY-MM | Chi phí của chính chủ token; không chọn owner khác |
| POST /billing/activate | policy_version + UUID request_id; không nhận giá từ client |
| PATCH /billing/preferences | budget_vnd + revision + request_id; từ chối thuộc tính giá/quota, phiên cũ 409 |
| GET /admin/billing/usage?month=YYYY-MM | Admin được đối chiếu vai trò mới từ Cognito; user-only |
| GET /billing/export?month=YYYY-MM | CSV của chính chủ; ghi audit |
| GET /admin/billing/export?month=YYYY-MM | CSV chi phí quản trị; kiểm tra directory mới, ghi audit |
| GET /admin/billing/status | Trạng thái đối chiếu; admin được kiểm tra vai trò mới |
| POST /admin/billing/reconcile | Đối chiếu ngay, lease dùng chung với worker; ghi audit kết quả |
| GET /admin/billing/versions?month=YYYY-MM&before=N | Xem tối đa 5 bản đối chiếu tài chính của kỳ, có phân trang; chỉ admin |

Giữ nguyên hợp đồng `/storage/usage`, upload, rescan, quản trị quota và API thông báo. Capability mới `billing_estimates`. Không có metadata bền vững trả 503 cho chi phí; bảng giá vẫn xem được. Không thêm bảng DynamoDB hoặc gọi Billing/Cost Explorer. Không dùng dữ liệu tệp mô phỏng frontend để dựng phí thật.

Cập nhật backend gồm `assets/billing-policy.json`, frontend, ZIP trash-cleanup có FileLifecycle/FileMetadataRepository mới và ZIP scan-pii có ghi thống kê xử lý. Backend cần các quyền DynamoDB Get/Put/Update/Query/transaction đã dùng trên `!quota!<UUID>`, `!history!<UUID>`, `!notifications!<UUID>` và scope quản trị UUID zero. Lambda scan cần PutItem trên partition `!quota!<owner>` của securedrive-files để lưu `billing-scan-*` (các policy hiện có cần được đối chiếu nếu giới hạn LeadingKeys). Không cấp quyền sửa giá từ ứng dụng. Không reset bảng hoặc quota cũ. Không cần secret/cổng thanh toán hay ENV mới.

Kiểm thử: `backend/tests/test_billing.py`, `backend/tests/test_billing_reliability.py`, `frontend/tests/billing.browser.mjs`. Dùng Moto/cục bộ, kiểm tích phân dung lượng, năm nhuận, retry/purge, scope token, giá bất biến, giữ quota admin, chống trùng thông báo, roster, làm tròn từng dòng, dữ liệu đến muộn/phiên bản báo cáo, lượt tính cũ, khôi phục sau lỗi quyền ghi thống kê, nhiều lượt quét chưa đồng bộ, purge khi còn chờ đối chiếu, cách ly tiếp tục khi thống kê lỗi và Chrome sáng/tối/mobile. Các kiểm tra local không xác nhận AWS thật đã được cập nhật.

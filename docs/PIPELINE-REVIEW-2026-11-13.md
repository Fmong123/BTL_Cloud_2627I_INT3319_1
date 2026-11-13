# Rà soát và gói sửa pipeline — 13/11/2026

Phạm vi: code local, dependency Lambda, hợp đồng API, giao diện và kiểm thử. Chưa triển khai AWS theo lựa chọn của người dùng. Không tải nội dung PDF riêng, không thay dữ liệu S3/DynamoDB, không gửi SNS thật.

## Bằng chứng đã có trên AWS

- `danh_sach_nhan_vien.csv`: quét lúc 15:02:03 ngày 13/11, phát hiện CCCD và số thẻ; workflow dừng 15:02:17 với `QuarantineFailed`, metadata vẫn `flagged/pending`. Đây là lượt đã thất bại, không còn thực sự xếp hàng.
- `pdf_co_mat_khau.pdf`: các lượt trong ảnh đều `ocr_failed`; lượt đọc metadata sau đó dùng `textract_pdf`, `extraction_complete=false`. Chưa đọc nội dung tệp để xác minh mã hóa. Tên tệp không được dùng làm bằng chứng về mật khẩu.
- Profile backend không có GetExecutionHistory/GetFunctionConfiguration. Profile maysec-console chưa có phiên đăng nhập. Vì vậy chưa xác minh được nguyên nhân gốc trong cấu hình/quyền Lambda đang chạy, cũng chưa xác minh layer/runtime thực tế.

## Các lỗi code và điểm không thống nhất đã sửa

| Vấn đề | Bản sửa |
| --- | --- |
| ZIP Scan chỉ có handler/common, phụ thuộc layer PDF bên ngoài | Đóng gói pypdf, cryptography, Pillow và dependency Linux; có requirements khóa phiên bản và manifest runtime/SHA256. |
| Thiếu parser vẫn đẩy PDF vào Textract; PDF có mật khẩu chỉ còn lỗi OCR chung | Thiếu parser/crypto có mã cấu hình riêng. PDF mã hóa AES có mật khẩu được nhận diện trước OCR; không tự mở khóa. |
| PDF có lớp chữ ngắn bị bắt đi OCR vì ngưỡng 20 ký tự | Ngưỡng mặc định 1; vẫn buộc OCR khi có trang thiếu chữ hoặc có ảnh. |
| PNG/JPEG cần Textract đọc lại S3 dù Lambda đã đọc đúng version | Với ảnh <=5.000.000 byte, gửi Bytes của version đã đọc; ảnh lớn hơn dùng S3Object có Version. Ghi số trang OCR. |
| TIFF nhiều trang đi API ảnh đồng bộ một trang | Dùng OCR tài liệu bất đồng bộ, đọc và kiểm tra đủ mọi trang/phân trang. |
| Preview có GIF/WebP nhưng bộ quét chưa hỗ trợ | Giải mã từng khung thành PNG trong bộ nhớ, OCR mọi khung; không ghi bản tạm lên S3, không giảm độ phân giải. |
| Lỗi quyền S3/Textract/KMS, giới hạn lượt gọi chỉ hiện scan_failed | Mã lý do riêng, giải thích tiếng Việt; lỗi tạm thời/cấu hình có thao tác quét lại phù hợp. |
| OCR có thể hết thời gian mà chưa kịp lưu kết quả | Chừa 15 giây cho lưu kết quả; kiểm tra phân trang, frame limit, số trang và giữ phần đã phát hiện khi bị gián đoạn. |
| Lỗi cấu hình cách ly nằm ngoài phần bắt lỗi | Đưa kiểm tra bucket/KMS và bước chuẩn bị vào phần có ghi trạng thái lỗi; thêm log theo file_id/phase. |
| Lambda cách ly lỗi, workflow lại phụ thuộc chính Lambda đó để ghi lỗi | Nhánh PersistQuarantineFailure dùng transaction DynamoDB độc lập, ghi trạng thái, audit và thông báo web; không copy/xóa S3. Nhánh phục hồi cũng đi qua xử lý lỗi này. |
| Kiểm tra biết workflow đã dừng nhưng metadata vẫn pending | Backend đối chiếu lượt đã dừng, giữ khoảng chờ Lambda cũ, ghi nhận cách ly thất bại cùng lịch sử. Không tự tạo lượt cách ly mới. |
| Badge, báo cáo, thông báo và nhóm tệp không thống nhất | Dùng nhãn lỗi cách ly theo lý do; sự kiện lỗi mới báo thất bại. Bộ lọc/nhóm tổng hợp flagged dùng “Chưa cách ly” vì bao gồm cả đang chờ và thất bại. |
| Tệp cách ly thất bại vẫn nằm trong nhóm Đang xử lý | Chuyển sang Cần kiểm tra; chỉ lượt đang chờ mới hiển thị Chờ cách ly. |
| Báo cáo quản trị bỏ sót lỗi copy/chuẩn bị cách ly | Tính các lỗi cách ly của tệp flagged vào tổng lỗi, biểu đồ ngày và thống kê người dùng; không tính lượt đang chờ là lỗi. |
| Admin thử lại cách ly nhưng nhãn lỗi cũ vẫn còn | Yêu cầu thử lại hợp lệ chuyển bước về pending và xóa lý do lỗi cách ly cũ; giữ kết quả quét, phát hiện và lý do đọc thiếu. |
| Báo cáo chưa rõ lý do lại hướng dẫn mở chính trang chi tiết đang xem | Hiển thị “Lý do” ngay dưới kết quả trích xuất; PDF khóa hiện giải thích mật khẩu. Phân biệt báo cáo thiếu lý do và mã chưa được giao diện hỗ trợ, không suy đoán PDF khóa từ lỗi OCR cũ. |
| Client báo cáo quét chưa nhận GIF/WebP dù schema hỗ trợ | Đồng bộ whitelist định dạng của client với schema backend và phần hiển thị. |
| Fallback workflow/admin đối chiếu ghi lỗi nhưng bỏ sót chuông chủ tệp | Thêm thông báo “Cách ly thất bại” cùng transaction trạng thái/audit; không gửi SNS và không tạo lượt cách ly mới. IAM Step Functions chỉ thêm PutItem vào partition thông báo. |
| Phát lại sự kiện lỗi cách ly cũ vẫn giữ nhãn Chờ cách ly | Nâng nhãn/tone của đúng sự kiện đó, giữ nguyên ID, thời điểm và trạng thái đã đọc. |
| SNS dùng tên gốc và chưa nói rõ phát hiện từ tài liệu đọc thiếu | Dùng tên hiển thị hiện tại, thêm mức độ đọc thiếu khi cần và ghi rõ phạm vi không phải kiểm tra mã độc; không đưa giá trị nhạy cảm vào thông báo. |

## Quy tắc được giữ

- Điều chỉnh tiếp theo yêu cầu người dùng: ảnh OCR thành công và xác nhận đủ trang/khung, không có chữ hoặc không có chuỗi CCCD/thẻ, trả safe với 0 phát hiện. Đây không phải lỗi OCR. Ảnh có CCCD/thẻ trả flagged và chuyển workflow cách ly; ảnh lỗi/đọc thiếu vẫn có trạng thái riêng. TIFF cần PAGE block đủ trang, GIF/WebP cần quét đủ khung. Quy tắc PDF có mật khẩu/không đọc đủ vẫn giữ nguyên.
- Lần cách ly đầu chạy tự động sau flagged; yêu cầu chạy lại riêng bước cách ly do admin tạo. Kiểm tra kết quả không tạo execution mới cho một lượt đã kết thúc.
- Không đọc đủ trang/khung thì không safe. Nếu phần đã đọc có CCCD/thẻ thì vẫn flagged, với extraction_complete=false.
- Không thay findings khi thử lại cách ly, không mở quyền tải tệp flagged/error/unscanned, không ghi đè kết quả của execution/version mới, tệp đã cách ly hoặc trong rác.
- Không gửi lại SNS khi kết quả lần gửi còn chưa rõ; giữ các bước đối soát và xác nhận nguy cơ gửi trùng.
- Các schema owner/admin nhận cùng detected_format, phương pháp, số trang/khung và lý do; thống kê OCR vẫn dùng textract_image/textract_pdf hiện có.

## Kiểm chứng local

- Backend: **383 passed**, gồm PDF có lớp chữ ngắn, PDF AES có mật khẩu, PDF hỏng/rỗng, PNG/JPEG/GIF/WebP/TIFF, ảnh không chữ/không PII trả safe, ảnh có CCCD/thẻ trả flagged, phân trang OCR, thiếu trang, lỗi quyền/network, cách ly copy/delete/recovery, hợp đồng workflow, thông báo, báo cáo lỗi, audit, auth, quota, lịch sử, lifecycle và billing.
- Frontend: **21 passed** (18 bài hiện có và 3 bài trạng thái/lý do/API pipeline); production build thành công.
- UI phục hồi pipeline: đạt, dùng FastAPI HTTP + Moto + handler Lambda thật trong source, SNS giả lập, giao diện 320–1440 px và dark mode.
- UI thông báo: đạt chuông/toast, đọc rồi reload, thông báo khi web đóng, liên kết tệp, inbox admin, thay quota, đổi tài khoản và hiển thị 320/390 px. Test fallback kiểm tra thông báo/audit/trạng thái cùng transaction, phát lại không đặt lại đã đọc; đối chiếu admin lặp không tạo thông báo trùng.
- Kiểm tra bổ sung sau phản hồi về lý do: sáu bài hợp đồng workflow vẫn đạt, có xác nhận `pdf_password_protected` xuyên suốt handler/metadata/API. UI xác nhận PDF khóa hiện “Lý do: PDF được bảo vệ bằng mật khẩu nên chưa đọc được”, còn báo cáo cũ thiếu mã hiện thông báo chưa ghi nhận lý do cụ thể.
- UI fullstack: đạt, production /api proxy, upload multipart, token demo ký, tách drive, đồng bộ người dùng, đọc version cách ly và audit. Dùng Chrome đã cài trên máy vì Chromium của Playwright chưa tải.
- Tất cả biểu thức JSONata được parse; Arguments thật của PersistQuarantineFailure được đánh giá bằng JSONata và transaction chạy trên Moto. Có test chặn execution/version/bucket sai, tệp trong rác, đã copied/completed.
- Sáu bài kiểm tra hợp đồng chạy nhánh từ file ASL thật, đánh giá JSONata, gọi handler thật trên Moto và đối chiếu metadata/API/quyền tải/thông báo: ảnh thường, ảnh nhạy cảm, PDF khóa, OCR chưa xác nhận đủ trang, Lambda cách ly không gọi được và SNS chưa rõ kết quả. Đây là mô phỏng local, chưa thay thế nghiệm thu Step Functions trên AWS.
- Cả bốn ZIP khớp source/dependency. 28 thư viện ELF Linux x86_64 được kiểm tra giữ nguyên từng byte; không lẫn DLL/PYD/PYC Windows. Manifest Scan khớp SHA256 của ZIP.
- Cảnh báo còn lại: Vite báo bundle chính >500 kB; test client có cảnh báo deprecation httpx/Starlette. Không phải lỗi của các bài kiểm thử.

Test/helper theo chính sách repo chỉ lưu local và không nằm trong gói cập nhật. Dependency native chưa được chạy trong Lambda Linux thật; cần nghiệm thu cloud sau khi cấu hình/deploy.

## Cách dùng gói cập nhật

Gói `AWS/build/maysec-pipeline-fix-2026-11-13.zip` là bản cập nhật để áp dụng lên checkout đang có, không phải bản cài mới. Gói chứa các file source thay đổi, bốn ZIP Lambda, frontend/dist, hướng dẫn này và manifest checksum. Không chứa .env, credentials, node_modules, venv, dữ liệu upload hoặc bộ test local.

1. Sao lưu code/config/policy cloud hiện tại và xác minh account/region. Scan ZIP đi kèm dành riêng cho **Python 3.12 / x86_64 / Amazon Linux 2023**; kiểm tra AWS/build/securedrive-scan-pii.runtime.json. Runtime/architecture khác cần build wheel khác.
2. Role Step Functions: áp dụng quyền UpdateItem files + PutItem audit + PutItem files giới hạn partition thông báo trong AWS/IAM/securedrive-sfn-dynamodb-policy.json. Role Scan/Quarantine giữ policy riêng trong AWS/IAM; kiểm tra bucket/quyền GetObjectVersion, Textract, KMS và DynamoDB theo AWS/DEPLOYMENT.md. Không cấp quyền xóa/copy S3 cho workflow.
3. Cập nhật ba Lambda Scan/Quarantine/Notify cùng common từ ZIP tương ứng. Kiểm tra ENV FILES_TABLE/AUDIT_TABLE, QUARANTINE_BUCKET/KMS_KEY_ID, SNS_TOPIC_ARN. KMS phải là ARN/UUID thật, không dùng alias.
4. Cập nhật workflow từ AWS/Orchestration/State_machine.json sau khi quyền đã đủ. Nhánh ghi lỗi không phụ thuộc Lambda và không sửa/xóa dữ liệu nội dung.
5. Cập nhật backend/frontend đồng bộ, restart backend và refresh frontend. Scan: MAX_SCAN_BYTES=100000000; MIN_PDF_TEXT_CHARS=1; timeout/memory gợi ý 300 giây/1024 MB để nghiệm thu tập mẫu.
6. Với tệp cũ bị pending: admin dùng Kiểm tra kết quả để đối chiếu; chỉ sau khi sửa cấu hình/quyền mới dùng Thử lại cách ly. Không chỉnh DynamoDB thành quarantined thủ công.
7. Nghiệm thu bằng tệp tổng hợp trên AWS: PDF text/scan/mã hóa, ảnh từng định dạng, copy/delete, trường hợp Lambda không invoke được, SNS và audit. Đối chiếu version, thời gian và trạng thái hiển thị trước khi áp dụng rộng.

## Giới hạn và điều chưa xác minh

- Chưa kết luận pipeline đang chạy trên AWS hết lỗi; chưa triển khai hoặc sửa IAM cloud.
- PDF có mật khẩu vẫn không thể quét nội dung khi chưa có bản đã mở khóa. Việc sửa giúp nhận diện đúng lý do, không vượt mật khẩu.
- Ảnh PNG/JPEG/GIF/WebP đầu vào tối đa 10 MiB; mỗi PNG chuyển đổi từ GIF/WebP phải <=5.000.000 byte. GIF/WebP tối đa 50 khung mặc định; vượt giới hạn thì chưa đọc đầy đủ. PDF/TIFF còn chịu giới hạn trang và thời gian OCR; Lambda một lượt không bảo đảm hoàn tất mọi tài liệu 100 MB.
- Nếu cả quyền/DynamoDB của workflow dự phòng cũng lỗi, không thể bảo đảm ghi trạng thái tức thời; execution sẽ báo lỗi persistence riêng, admin cần đối chiếu sau khi sửa dịch vụ/quyền.
- Hệ thống nhận diện CCCD và mẫu số thẻ, không phải bộ quét mã độc hay bộ phát hiện mọi loại thông tin nhạy cảm.

Tham chiếu chính thức: [giới hạn Textract](https://docs.aws.amazon.com/textract/latest/dg/limits-document.html), [Document/Bytes](https://docs.aws.amazon.com/textract/latest/APIReference/API_Document.html), [dependency PDF](https://pypdf.readthedocs.io/en/stable/user/installation.html), [AWS SDK integration và IAM](https://docs.aws.amazon.com/step-functions/latest/dg/supported-services-awssdk.html), [DynamoDB transaction](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html).

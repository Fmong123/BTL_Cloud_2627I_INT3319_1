# Kiểm tra và nghiệm thu

Nguồn: [CI](../../.github/workflows/check.yml), [package.json](../../frontend/package.json), [requirements-dev](../../backend/requirements-dev.txt), [gitignore](../../.gitignore). Tách bằng chứng source/local với bằng chứng thực tế trên AWS.

## Bản clone mới

CI hiện dùng Python 3.12, Node.js 24, pnpm 10, cài requirements.txt và dependency frontend theo lockfile. Từ gốc repo kiểm cú pháp:

```powershell
python -m compileall -q backend/app launcher AWS/Lambda_AWS
```

Từ frontend/:

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd run build
```

CI chỉ kiểm cú pháp/build, không deploy, không cần credentials và không chạy bộ test local. Kiểm tra tài liệu không cần chạy API hoặc gọi cloud.

## Bộ test local khi có sẵn

Test/helper/builder được .gitignore loại khỏi Git. Bản clone mới không có chúng; không diễn giải thiếu file test là lỗi runtime ứng dụng.

Từ backend/:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest tests -q
```

Từ frontend/:

```powershell
npm.cmd test
pnpm.cmd exec playwright install chromium
npm.cmd run test:ui
```

package.json còn có test:api-client, test:ui:dev, test:ui:folders, test:ui:admin, test:ui:pipeline; chỉ dùng khi có script tương ứng. Test UI tự dựng FastAPI/Moto và frontend trên cổng 8019/5189, cần Python/backend requirements-dev và trình duyệt. Có thể đặt PYTHON, CHROME_EXECUTABLE; ảnh ở frontend/test-results, Git bỏ qua.

Bộ test dùng khóa/client/dịch vụ giả và dữ liệu tổng hợp, không nghiệm thu quyền hoặc triển khai AWS thật. Builder Lambda và --check theo [triển khai AWS](aws-deployment.md).

## Kiểm tra Local không AWS

1. Chạy theo [README](../../README.md), kiểm health storage=local, metadata disabled và auth=dev. User Pool trống, pipeline/demo login tắt.
2. Upload tệp nhỏ không rỗng; API 201, id/key/size đúng. Dùng Get-FileHash so tệp gốc với backend/data/<key> nếu chưa đổi storage root.
3. File rỗng bị từ chối; thử trần thấp trong môi trường test để kiểm 413 rồi hoàn nguyên config/restart.
4. Metadata disabled không có thư viện/preview/quét server. Reload không tự gửi lại File đang tải dở.
5. Chế độ demo upload chỉ mô phỏng, không chứng minh byte được lưu.

## Nghiệm thu S3 + DynamoDB + Cognito

Chuẩn bị cloud theo [triển khai AWS](aws-deployment.md), token theo [Cognito](../guides/authentication.md). Dùng tài khoản và dữ liệu thử tổng hợp được phép. Xác minh principal bằng profile/role thực tế của server; /health không thay thao tác kiểm quyền.

| Nhóm | Ca cần kiểm và bằng chứng |
| --- | --- |
| Owner/quyền | Hai user có Drive/quota/lịch sử riêng; ID ngoài owner trả 404; user gọi admin 403; admin khác/đích ngoài scope bị chặn; token sai/hết hạn |
| Upload | Tệp sạch nhỏ → 201; đối chiếu id/key/size/version giữa API, S3 và DB/audit; thử multipart dưới trần; timeout đối soát ID trước gửi lại |
| Scan sạch | TXT sạch → safe; chỉ khi đó xem/tải và so hash; 201 không phải safe |
| PII/cách ly | Mẫu CCCD/thẻ giả → flagged → quarantined; xác minh copy/version/KMS, xóa đúng nguồn, audit/thông báo |
| OCR | PDF chữ ngắn, PDF scan/mixed nhiều trang, PDF mật khẩu, ảnh chữ/không chữ, GIF/WebP nhiều khung, TIFF; kiểm format/method/pages/duration/completeness và lý do |
| Lỗi cách ly | Copy lỗi giữ flagged, xóa nguồn lỗi quarantine_delete_failed; Lambda ghi lỗi không chạy thì kiểm fallback workflow/audit/web notice |
| Rescan | Chặn đọc khi scanning, UUID retry không nhân execution, cooldown, execution cũ không ghi đè; trạng thái không hợp lệ bị chặn |
| Xem xét cách ly | Owner yêu cầu, inbox admin, keep/restore có lý do/audit; restored giữ scan DB và đọc đúng version cách ly |
| Vận hành | Request nén/hoàn tất, check/retry; recovery bỏ OCR, copy/delete retry; SNS failed/sending/unknown đối soát, xác nhận/gửi lại đúng điều kiện |
| Quota | Mặc định/quota riêng/kích hoạt 10 GB đúng chính sách; đồng thời upload/đổi quota, failed và reservation unknown; không giảm quota khi chỉ trash |
| Thư mục | Tạo/cấp con/đổi tên/move, cấm chu trình/tên trùng, upload giữ đích, move nhóm; trash/restore cây và giới hạn 97 mục |
| Purge/cleanup | Xóa hết version/marker hai bucket rồi mới giảm quota; lỗi giữ deleting/purging; retry, restore đồng thời, nhóm chưa hết hạn, history và ledger còn |
| Thông báo | Quét khi browser đóng, replay không trùng/reset read; hai admin có read riêng; đổi role loại sự kiện ngoài scope; không coi SNS receipt là đã đọc email |
| Tài khoản | Quota và audit; khóa/mở Cognito, pending chặn token cũ, tiếp tục đúng request; tài khoản admin không bị quản trị |
| Báo cáo/history | Lọc ngày/user/scope, CSV/PDF tiếng Việt đủ mục; audit trước tải; không PII/raw payload, không hiển thị tổng dở khi lỗi |
| Chi phí | Miễn phí một lần/user, kích hoạt không tính ngược, làm tròn/kỳ tháng, roster đổi vai trò, OCR phục hồi, purge khi chờ đối chiếu, revision/CSV và cảnh báo chống trùng |
| Phiên/UI | Đổi tài khoản giữa upload/preview, response cũ bị bỏ, reload/cache/API scope, hash route, sáng/tối/mobile |

Thử lỗi trên tài nguyên thử theo kế hoạch; không xóa metadata/lease hoặc giảm quota thủ công để che kết quả chưa rõ. SNS gửi thật có thể tạo email; kiểm kênh/subscription đúng phạm vi nghiệm thu.

## Lưu bằng chứng

Ghi commit/bản triển khai, thời điểm/múi giờ, config không bí mật, principal, file ID, execution ARN và version/checksum. Ghi riêng kết quả API, storage, metadata/audit, workflow/log và UI. Không đưa token, credentials, OCR hoặc nội dung nhạy cảm vào bằng chứng.

Chỉ bật lịch cleanup khi ca hết hạn/chưa hết hạn/retry đạt. Báo cáo theo ngày đưa vào [archive/reviews](../archive/README.md), không thay các chính sách hiện hành.

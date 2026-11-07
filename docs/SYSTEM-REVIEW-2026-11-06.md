# Rà soát hệ thống MâySec — 06/11/2026

Phạm vi: mã nguồn và bộ công cụ local tại `G:/code/BTL_Cloud_2627I_INT3319_1`; đối chiếu thêm bản frontend cũ tại `G:/code/GPT cloud`. Không sửa mã nguồn, xóa dữ liệu, commit hoặc triển khai AWS trong lần rà soát này. File này là kết quả rà soát mới.

> Cập nhật sau rà soát, theo yêu cầu thống nhất phân quyền: mục 1 đã được xử lý trong mã nguồn. Tổng quan/cách ly/tài khoản/thống kê dùng chung `backend/app/services/admin_scope.py`; chỉ nhận chủ tài khoản role=user, đọc mới nhóm Cognito, trả 403 cho admin và tài khoản chưa phân quyền. Đã kiểm tra gọi trực tiếp API đọc/tải/lịch sử/duyệt cách ly/thao tác quét bằng hai admin, đổi nhóm khi cache còn nóng và lỗi directory. Sau sửa: 225 test backend, 11 test frontend, build và hai bộ UI fullstack/admin đều qua. Chưa triển khai AWS. Các mục khác bên dưới vẫn là kết quả rà soát chưa được xử lý trong thay đổi phân quyền này.

## Kết luận

> Cập nhật sau rà soát: mục 5 đã được bổ sung. Cleanup dùng chung luồng purge với API thư mục, chỉ dọn nhóm đã hết hạn, xóa hết nội dung trước metadata, bảo vệ khôi phục đồng thời và tiếp tục xóa dở. ZIP/policy/env cần cập nhật theo [hướng dẫn cleanup](trash-cleanup.md); chưa triển khai AWS. Phát hiện ở mục 5 bên dưới giữ nguyên làm lịch sử đối chiếu.

> Cập nhật tiếp theo: phần còn thiếu ở mục 4 đã được bổ sung trong mã nguồn, gồm thử lại riêng cách ly, gửi đúng kênh và xác nhận thủ công theo bằng chứng, có audit và chặn xung đột. Bốn ZIP local ở mục 3 đã được build lại và kiểm tra khớp source. Xem [hướng dẫn xử lý pipeline](pipeline-recovery.md) để cập nhật đồng bộ workflow/Lambda/backend/frontend; chưa triển khai hoặc nghiệm thu AWS thật. Nội dung phát hiện bên dưới giữ lại để đối chiếu thời điểm rà soát.

Các chức năng chính đã kết nối frontend–backend và vượt qua kiểm thử cục bộ: đăng nhập, dữ liệu riêng theo tài khoản, upload, thư mục, Thùng rác, quản trị tài khoản/quota và thống kê/xuất CSV/PDF. Tuy nhiên, hệ thống **chưa thống nhất hoàn toàn**. Cần ưu tiên đồng nhất phạm vi admin, xử lý quota Local + DynamoDB và cập nhật gói Lambda trước khi bàn giao/triển khai.

Không thấy file mã nguồn frontend đứng riêng ngoài đồ thị import; không có cơ sở để xóa component chỉ vì tên gần giống nhau. Phần có thể dọn chủ yếu là kết quả sinh tự động, tài liệu lịch sử và bản frontend tuần 1 riêng biệt.

## Kết quả kiểm chứng

| Kiểm tra | Kết quả |
| --- | --- |
| Backend: `.venv/Scripts/python.exe -m pytest tests -q` | 222 passed; một cảnh báo deprecation của TestClient/httpx |
| Frontend: `npm test` | 11 passed |
| Frontend: `npm run build` | Thành công; cảnh báo chunk chính khoảng 528 kB trước gzip |
| `npm run test:ui` | Qua: HTTP FastAPI thật với Moto, token demo có chữ ký, upload multipart, ba Drive tách biệt, hồ sơ người dùng, tải bản cách ly có audit |
| `npm run test:ui:folders` | Qua: tạo/cấp con/đổi tên/di chuyển, kéo thả, upload vào thư mục, xóa/khôi phục cây, mobile/dark |
| `npm run test:ui:admin` | Qua: chỉ user trong danh sách quản lý, gợi ý tìm kiếm, đặt lại, quota, khóa/mở, audit, CSV/PDF, responsive 320–1440 và dark |
| Đồ thị import frontend từ `main.jsx` | 69/69 file nguồn được tham chiếu; không thấy relative import thiếu |
| Cú pháp Python/JSON AWS | Đọc/parse thành công nguồn backend, launcher, Lambda và các JSON AWS |
| `python AWS/package_lambdas.py --check` | **Không đạt**: Scan và Cleanup ZIP khác source; Quarantine và Notify khớp |
| Tình huống bổ sung ngoài suite | Tái hiện lệch phân quyền admin, lệch quota Local và thư mục hết hạn chưa được cleanup |

Các kiểm thử AWS dùng Moto và directory Cognito giả lập. Chưa kiểm chứng cấu hình, quyền IAM/KMS, layer, schedule, EventBridge, SNS hoặc version Lambda đang chạy trên AWS thật. Health/capability chỉ mô tả cấu hình/client, không chứng minh quyền cloud đầy đủ. Bộ test hiện qua vẫn còn thiếu các tình huống đã phát hiện dưới đây.

## Các điểm cần xử lý

### 1. Phạm vi admin chưa nhất quán giữa các module — đã xử lý sau rà soát

Yêu cầu hiện tại là admin chỉ xem/quản lý tài khoản user. Accounts và Reports đã lọc vai trò user, từ chối gọi trực tiếp vào tài khoản admin. Quarantine, Overview và các API quản trị tệp vẫn chỉ kiểm tra chủ tệp thuộc Cognito pool, chưa loại admin.

Bằng chứng giả lập hai admin A/B:

- A gọi danh sách cách ly với owner B: HTTP 200.
- A đọc chi tiết tệp của B: HTTP 200.
- A gọi content của tệp cách ly B: HTTP 200, nhận đúng nội dung `private data`.
- A gọi lịch sử quản trị tài khoản B: HTTP 403.

Đây là khác biệt quyền thực tế ở backend, không chỉ là vấn đề ẩn nút. Tổng quan bảo mật cũng cộng cả tài khoản admin, trong khi Thống kê chỉ cộng user; hai trang vì vậy có thể cho số liệu khác nhau ngay cả khi đã đối chiếu bộ lọc.

Vị trí: [pool_accounts và danh sách cách ly](G:/code/BTL_Cloud_2627I_INT3319_1/backend/app/routers/admin.py:56), [admin_file](G:/code/BTL_Cloud_2627I_INT3319_1/backend/app/routers/admin.py:221), [content](G:/code/BTL_Cloud_2627I_INT3319_1/backend/app/routers/admin.py:326), đối chiếu [require_user_account](G:/code/BTL_Cloud_2627I_INT3319_1/backend/app/routers/admin_accounts.py:48).

Hướng xử lý: dùng chung quy tắc xác định user thuộc phạm vi quản trị cho list/overview/detail/history/content/review/scan-operation; kiểm tra lại vai trò khi thao tác. Drive cá nhân tiếp tục theo owner. Bổ sung tình huống hai admin và tài khoản đổi nhóm vào bộ kiểm chứng.

### 2. Ưu tiên vừa: quota Local + DynamoDB còn giới hạn cố định 1 GB

API quản trị và `/storage/usage` dùng quota riêng trong DynamoDB. Adapter Local vẫn chặn tổng byte vượt `FREE_STORAGE_BYTES`, bất kể quota đã chỉnh. Nhánh báo lỗi còn ghi “gói miễn phí 1 GB”.

Tái hiện: metadata và bộ đếm đĩa giả lập đang dùng 1.000.000.000 byte; admin tăng quota lên 2.000.000.000 byte thành công. Usage trả còn 1.000.000.000 byte nhưng upload thêm một byte trả 413. Không tạo file 1 GB thật trong lần thử này.

Vị trí: [LocalStorage.upload](G:/code/BTL_Cloud_2627I_INT3319_1/backend/app/services/storage.py:148), [nhánh báo lỗi upload](G:/code/BTL_Cloud_2627I_INT3319_1/backend/app/routers/files.py:266), [quota dùng settings](G:/code/BTL_Cloud_2627I_INT3319_1/backend/app/services/quota.py:19).

Ảnh hưởng riêng chế độ Local + DynamoDB có quota tùy chỉnh; chưa tái hiện lỗi này với S3. Cần thống nhất nơi thực thi quota, vẫn giữ cơ chế khóa/chống upload đồng thời và quota mặc định cho Local không metadata.

### 3. Ưu tiên trước triển khai: ZIP Lambda chưa khớp source

Kiểm tra nội dung ZIP so với builder hiện tại:

| ZIP | Chênh lệch |
| --- | --- |
| `securedrive-scan-pii.zip` | `handler.py` và `pipeline_common.py` khác source |
| `securedrive-trash-cleanup.zip` | Khác các module backend đã sửa; thiếu các module Accounts/Reports mới theo cách đóng gói hiện tại |
| `securedrive-quarantine-file.zip` | Khớp |
| `securedrive-notify.zip` | Khớp |

Đây là kết luận về ZIP local trong `G:/code/BTL_Cloud_2627I_INT3319_1/AWS/build`, chưa phải kết luận về version đang triển khai cloud. Nếu upload ZIP hiện có, hành vi có thể khác backend/source vừa nghiệm thu.

Hướng xử lý: hoàn tất sửa source, build lại và kiểm tra cả bốn ZIP từ cùng phiên bản trước khi bàn giao. Builder Cleanup hiện gom toàn bộ Python trong backend/app, kể cả router không được handler dùng; nên thu gọn theo phụ thuộc thực tế để tránh mỗi thay đổi giao diện quản trị làm gói cleanup lệch. Không kết luận thiếu module Reports trong ZIP cũ tự nó làm cleanup hỏng: handler cleanup không khởi động FastAPI/Reports.

### 4. Phần còn thiếu: thao tác vận hành cho lỗi cách ly/thông báo

Tại thời điểm rà soát ban đầu: có kiểm tra execution, thử quét lại trong các trạng thái cho phép, yêu cầu nén và duyệt yêu cầu cách ly; chưa có API/UI hoàn chỉnh để chạy lại riêng bước copy/delete cách ly hoặc đối soát thông báo chưa rõ kết quả. Cập nhật sau rà soát: đã bổ sung [xử lý riêng bước cách ly và đối soát SNS/email](pipeline-recovery.md). Webhook đã ngừng theo yêu cầu; lịch sử cũ được giữ và yêu cầu cũ không được gửi lại.

Notify cố ý giữ `sending/unknown` và từ chối tự gửi lại để tránh gửi trùng; đây là nguyên tắc an toàn đang có. Phần thiếu là công cụ cho admin xem bằng chứng giao nhận, xác nhận kết quả và thực hiện bước tiếp theo có audit. Không nên thêm nút retry mù quáng hoặc gọi “Quét lại” thay cho xử lý riêng bước cách ly.

Vị trí: [các action đang hỗ trợ](G:/code/BTL_Cloud_2627I_INT3319_1/backend/app/services/scan_operations.py:20), [delivery cần đối soát](G:/code/BTL_Cloud_2627I_INT3319_1/AWS/Lambda_AWS/notification/handler.py:68). Giới hạn này cũng được ghi tại `G:/code/BTL_Cloud_2627I_INT3319_1/AWS/DEPLOYMENT.md`.

### 5. Giới hạn đã biết: thư mục hết hạn chưa được tự dọn

Cleanup chỉ xử lý file storage=s3 và bỏ qua partition bắt đầu bằng `!`; thư mục nằm trong `!folders!<owner>`. Tệp hết hạn có thể bị xóa nhưng metadata thư mục vẫn còn. Thử với thư mục rỗng đã hết hạn: cleanup trả deleted=0/failed=0; GET /folders vẫn trả thư mục đó trong rác. Khôi phục bị chặn vì đã hết hạn; người dùng vẫn có thể xóa vĩnh viễn thủ công.

Vị trí: [bộ lọc cleanup](G:/code/BTL_Cloud_2627I_INT3319_1/AWS/Lambda_AWS/trash_cleanup/handler.py:32), [partition thư mục](G:/code/BTL_Cloud_2627I_INT3319_1/backend/app/services/folders.py:38). Đây là giới hạn đã được ghi trong frontend guide, cần bổ sung nếu muốn cam kết tự dọn cả cây sau 30 ngày. Khi bổ sung phải giữ revision và xử lý xóa dở/khôi phục đồng thời.

### 6. Bàn giao/CI chưa tái lập đầy đủ bộ kiểm chứng

`.gitignore` cố ý loại tests và `AWS/package_lambdas.py`. README đã nêu rõ chính sách này. CI chỉ compile Python và build frontend; không chạy các kiểm thử nghiệp vụ đã dùng trong lần rà soát.

Hệ quả: clone repository mới có thể chạy ứng dụng nhưng không tự có bộ test/builder để lặp lại kết quả 222/11/UI và kiểm tra ZIP. Không nên xóa các thư mục test local vì tưởng chúng là file thừa. Nếu giữ chính sách hiện tại, cần bàn giao bộ công cụ local riêng cùng phiên bản; nếu muốn CI kiểm nghiệp vụ thì phải thay chính sách versioning và workflow một cách có chủ đích.

Vị trí: [.gitignore](G:/code/BTL_Cloud_2627I_INT3319_1/.gitignore:17), [CI backend](G:/code/BTL_Cloud_2627I_INT3319_1/.github/workflows/check.yml:31), [CI frontend](G:/code/BTL_Cloud_2627I_INT3319_1/.github/workflows/check.yml:47).

Các file Accounts/Reports, CSS, component tìm kiếm/ngày tháng và font mới hiện còn untracked trong working tree. Khi bàn giao phải lấy đủ cả file sửa và file mới; không chỉ lấy danh sách modified. Không commit/push trong lần rà soát này.

### 7. Tài liệu hiện hành và tài liệu cũ còn chồng chéo

- README và frontend guide chưa liệt kê hai trang Thống kê/Quản trị tài khoản; một số chỗ vẫn ghi quota cố định 1 GB thay vì quota mặc định có thể chỉnh.
- `G:/code/BTL_Cloud_2627I_INT3319_1/docs/phase3-api.md` vẫn viết ứng dụng dùng dev-user, dù đầu file có dẫn contract mới.
- Phụ lục `G:/code/BTL_Cloud_2627I_INT3319_1/docs/AWS-HANDOFF-2026-10-31.md` còn chỉ phạm vi backend theo dev-user/prefix cũ, và quickstart vẫn có bước chỉ đến policy dev. Trong khi source hiện dùng sub Cognito, partition thư mục và quyền quản trị tài khoản mới. Cần hợp nhất hướng dẫn IAM hiện hành; một lời dẫn sang tài liệu mới chưa loại hết khả năng làm theo bước cũ.
- Báo cáo codebase ngày 31/10 và upload_to_s3_guide đã được ghi rõ là lịch sử. Có thể lưu trữ tham khảo, không coi nội dung lịch sử là mô tả runtime hiện tại.

Nên lấy API contract, hướng dẫn Cognito và admin-reports-accounts hiện tại làm cơ sở, cập nhật trang chỉ mục và đánh dấu rõ tài liệu thay thế. Không cần xóa mọi tài liệu cũ.

## File/thư mục nên giữ, dọn hoặc lưu trữ

| Nhóm | Kết luận |
| --- | --- |
| `G:/code/BTL_Cloud_2627I_INT3319_1/frontend/src` | Giữ: 69/69 file đều được đồ thị import sử dụng. FileDetail/AdminFileDetail, report/component và service cùng tên gần nhau phục vụ vai trò khác nhau. Kiểm tra này không chứng minh mọi export/nhánh trong từng file đều cần thiết. |
| Backend/app, Lambda, launcher, config/IAM/workflow | Giữ nguồn runtime; không tìm thấy file tracked dạng .bak/.orig/.rej để xóa ngay. Hai ZIP lệch cần thay bằng bản đúng, không đơn giản bỏ ZIP. |
| `frontend/dist`, `frontend/test-results`, `backend/test-results`, `backend/.test-tmp`, `.pytest_cache`, `__pycache__` trong repo chính | Kết quả sinh tự động; có thể dọn khi không còn dùng để kiểm tra/chạy. Ảnh failure.png có thể là ảnh lần test trước, không tự chứng minh lần hiện tại thất bại. |
| node_modules, .pnpm-store, backend/.venv trong repo chính | Thư viện cài cục bộ, không phải nguồn thừa; có thể tạo lại nhưng xóa sẽ cần cài lại để chạy. Không đưa vào gói source. |
| `G:/code/BTL_Cloud_2627I_INT3319_1/backend/data` | Có dữ liệu upload Local và quota lock DB; không xóa như cache. |
| `G:/code/BTL_Cloud_2627I_INT3319_1/launcher/runtime` | Chỉ cân nhắc dọn log/đầu ra cũ. Giữ settings và thông tin tiến trình đang dùng; không xóa cả thư mục tùy tiện. |
| backend/tests, frontend/tests, AWS/package_lambdas.py trong repo chính | Giữ bộ kiểm chứng local; đang bị ignore có chủ đích, không đồng nghĩa không cần. |
| `G:/code/GPT cloud/frontend` và README cùng thư mục | Bản frontend tuần 1 riêng, không phải frontend do launcher của repo chính khởi động. Nên gắn nhãn bản cũ/lưu trữ để tránh sửa hoặc chạy nhầm. |
| `G:/code/GPT cloud` chứa DOCX, hướng dẫn, output, scripts, tmp | Kiểm tra và lưu tài liệu cần thiết trước khi dọn; không kết luận mọi file trong workspace này đều dư. |
| Font NotoSans và OFL trong backend/app/assets/fonts | Cần cho PDF tiếng Việt và giấy phép; giữ khi đóng gói backend. |
| .env thật, credentials và dữ liệu cá nhân | Giữ riêng theo môi trường, không đưa vào Git/gói bàn giao. Git chỉ đang theo dõi hai .env.example; chưa phải kiểm toán bí mật trong toàn bộ lịch sử Git. |

## Thứ tự đề xuất

1. Thống nhất quyền user-only cho toàn bộ API quản trị, rồi sửa quota Local + DynamoDB và bổ sung tình huống kiểm chứng tương ứng.
2. Build/đối chiếu lại Lambda ZIP, hợp nhất hướng dẫn cấu hình/IAM và gom đủ file mới khi bàn giao.
3. Hoàn thiện thao tác riêng cho lỗi cách ly/thông báo và cleanup metadata thư mục nếu cần vận hành lâu dài.
4. Dọn đầu ra sinh tự động, lưu trữ frontend/tài liệu cũ; quyết định cách bàn giao bộ test/builder hiện chỉ có local.
5. Sau đó nghiệm thu cloud thật với tài khoản/tệp thử: quyền IAM/KMS, S3 versioning, OCR, EventBridge/Step Functions, SNS/email và lịch cleanup. Kết quả local chưa thay thế bước này.

Các tính năng mở rộng như chia sẻ tệp, lịch sử phiên bản trên giao diện, tải nhóm thành ZIP và phát hiện mật khẩu/API key chưa được triển khai đầy đủ; đây là phạm vi chức năng mở rộng, cần tách khỏi các lỗi đồng bộ đã xác nhận ở trên.

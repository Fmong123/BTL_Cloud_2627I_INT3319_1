# MaySec Launcher cho Windows

Nhấp đúp **`MaySec.cmd` ở thư mục gốc project**. Launcher mở menu tiếng Việt trong một cửa sổ terminal, không cần thư viện Python riêng để mở menu. Cần Python 3.10+; Python, Node.js và AWS CLI là các công cụ nền được cài trên máy. Launcher hỗ trợ kiểm tra và cài dependency của project, không tự cài trình cài đặt hệ thống.

## Dùng nhanh

1. Chọn **4 → 1** để kiểm tra môi trường. Nếu thiếu thư viện, dùng **4 → 2**; nếu thiếu pnpm, dùng **4 → 4** để cài pnpm vào riêng `launcher/runtime/tools/`.
2. Chọn **2** để chọn Demo, Local, Local + DynamoDB hoặc S3 + DynamoDB.
3. Chọn **3 → 1** để xem cấu hình hiệu lực và nguồn của từng giá trị. Có thể chỉnh port, dung lượng, thư mục local, bucket nguồn/cách ly, region, tên bảng, profile, cờ pipeline và ARN quét lại trong menu này.
4. Với chế độ AWS, chọn **5** để tạo/chọn profile, đăng nhập và kiểm tra danh tính. Không cần AWS để chạy Demo/Local.
5. Chọn **1** để khởi động. Launcher chờ API và frontend sẵn sàng rồi mở trình duyệt. Các dịch vụ chạy đồng thời dưới sự quản lý của cùng một cửa sổ.
6. **6** mở trạng thái/log và các lối mở nhanh. **7** khởi động lại với cấu hình mới. **8** dừng dịch vụ, giữ menu. **0** thoát và dừng dịch vụ.

Ctrl+C hoặc EOF cũng thoát và dọn tiến trình. Trên Windows, Job Object có `KILL_ON_JOB_CLOSE` dọn các tiến trình server con khi cửa sổ/controller bị đóng đột ngột. Một khóa hệ điều hành ngăn mở hai launcher của cùng checkout; không dùng file PID cũ để giết tiến trình. Port đang bận được báo lỗi, không tự giết ứng dụng đang giữ port.

## File và phạm vi thay đổi

```text
MaySec.cmd                  Điểm mở ở gốc project
launcher/
  main.py                   Menu terminal
  config.py                 Đọc ENV, lưu và đồng bộ cấu hình
  environment.py            Kiểm tra/cài dependency
  aws_profiles.py           Profile, xác thực, kiểm tra AWS
  project.py                Server, Job Object, khóa, log
  runtime/                  Cấu hình riêng, log, khóa, pnpm riêng (Git bỏ qua)
```

Không sửa mã ứng dụng, `requirements*.txt`, `pnpm-lock.yaml` hay ENV gốc. Cài dependency thay đổi `backend/.venv` và `frontend/node_modules`; cài CRT chỉ bổ sung vào venv. Profile AWS thay đổi file chuẩn của AWS trên máy khi bạn chủ động tạo/cập nhật/đăng nhập, không lưu key vào project. Thư mục local được ứng dụng tạo khi cần lưu file.

## ENV và cấu hình

### Bản mẫu đầy đủ trong launcher

Xem [`.env.example`](.env.example): tập hợp toàn bộ biến backend/frontend mà launcher hỗ trợ, secret ký phiên demo và các biến đường dẫn AWS được giữ từ terminal. Mỗi biến có giải thích ngay phía trên. Đây là tài liệu tham khảo; launcher **không tự nạp `launcher/.env`**.

Để dùng bản mẫu:

1. Chép phần giữa `BEGIN BACKEND` và `END BACKEND` vào `backend/.env`.
2. Chép phần giữa `BEGIN FRONTEND` và `END FRONTEND` vào `frontend/.env.local`.
3. Nếu các file đã tồn tại, chỉ cập nhật biến cần thay đổi; không ghi đè cấu hình đang dùng. Có thể dùng các bản mẫu tách sẵn tại [`backend/.env.example`](../backend/.env.example) và [`frontend/.env.example`](../frontend/.env.example), nhưng nhớ kiểm tra auth theo chế độ bên dưới.
4. Mở `MaySec.cmd`, chọn chế độ ở menu **2**, kiểm tra cấu hình tại **3 → 1**, rồi chọn **1** để chạy. Nếu đã chạy, dùng **7** để khởi động lại.

Bản mẫu tổng hợp chọn `MAYSEC_AUTH_MODE=dev`, metadata tắt và profile trống để thử Local không AWS. Nếu ENV ghi rõ `dev`, launcher giữ giá trị đó khi chuyển chế độ; cần đổi sang `cognito` trước khi dùng S3.

| Chế độ ở menu 2 | Launcher tự đặt | Cần cấu hình thêm |
| --- | --- | --- |
| Demo | Frontend `demo`, không chạy backend | Không cần AWS; chỉ mô phỏng giao diện |
| Local | Storage `local`, metadata `disabled`, frontend `api`, pipeline tắt | Giữ auth `dev` để thử không token; API danh sách/trạng thái file chưa dùng được khi metadata tắt |
| Local + DynamoDB | Storage `local`, metadata `dynamodb`, frontend `api`, pipeline tắt | Chọn AWS profile hợp lệ, đúng ba tên bảng; có thể giữ auth `dev` |
| S3 + DynamoDB | Storage `s3`, metadata `dynamodb`, frontend `api` | AWS profile, bucket/region S3, auth `cognito`, User Pool/App client ID và cấu hình đăng nhập frontend; chỉ bật pipeline khi hạ tầng sẵn sàng |

Các nhóm biến trong bản mẫu:

| Nhóm | Ý nghĩa |
| --- | --- |
| `MAYSEC_STORAGE_*`, `MAYSEC_LOCAL_STORAGE_DIR`, `MAYSEC_MAX_FILE_SIZE_BYTES`, `MAYSEC_CORS_ORIGINS` | Nơi lưu nội dung, thư mục local, giới hạn tệp và origin được gọi API |
| `MAYSEC_METADATA_MODE`, `DYNAMODB_*` | Bật lưu metadata và chọn ba bảng files/audit/users; DynamoDB bắt buộc Sydney |
| `MAYSEC_AUTH_MODE`, `MAYSEC_DEV_ROLE`, `COGNITO_*` | Xác thực token Cognito hoặc danh tính phát triển; `dev` không dùng với S3 |
| `MAYSEC_DEMO_LOGIN_ENABLED`, `MAYSEC_DEMO_SIGNING_KEY` | Bộ chọn tài khoản demo và secret ký phiên, khác với Demo chỉ giao diện; secret chỉ ở backend và không xuất hiện trong bảng cấu hình |
| `AWS_PROFILE`, `S3_BUCKET_NAME`, `AWS_REGION`, `MAYSEC_QUARANTINE_BUCKET_NAME`, `MAYSEC_S3_*` | Danh tính AWS, bucket nguồn/cách ly, region S3 và tham số upload multipart |
| `MAYSEC_SCAN_PIPELINE_ENABLED`, `MAYSEC_RESCAN_STATE_MACHINE_ARN` | Trạng thái pipeline của ứng dụng và workflow quét lại đã triển khai |
| `VITE_UPLOAD_MODE`, `VITE_API_BASE_URL`, `VITE_MAX_FILE_SIZE_MB` | Cách frontend upload, URL API và giới hạn dung lượng; được launcher đồng bộ |
| `VITE_COGNITO_*` | Domain đăng nhập, App client ID, URL callback/logout; App client ID phải khớp backend |
| `AWS_CONFIG_FILE`, `AWS_SHARED_CREDENTIALS_FILE`, `AWS_LOGIN_CACHE_DIRECTORY`, `AWS_CA_BUNDLE` | Tùy chọn đường dẫn AWS/CA qua terminal; không được đọc từ file ENV và không truyền cho frontend |

Biến `VITE_*` là cấu hình công khai của trình duyệt. Credentials AWS nằm trong profile; secret ký phiên demo chỉ đặt trong `backend/.env` hoặc terminal.

### Những giá trị không phải ENV

Chế độ chạy, port và giới hạn ghi đè nằm trong `launcher/runtime/settings.json`, được tạo/lưu qua menu. Không có biến `LAUNCHER_MODE`, `WEB_PORT` hoặc `API_PORT` để thay thế chúng. Cấu trúc mặc định để tham khảo:

```json
{
  "version": 1,
  "mode": "local",
  "web_port": 5173,
  "api_port": 8000,
  "max_file_mb": null,
  "overrides": {}
}
```

`mode` nhận `demo`, `local`, `local-db`, `s3-db`; chọn bằng menu **2**. Hai port khác nhau, từ 1024 đến 65535, chỉnh ở **3 → 2**. `max_file_mb=null` nghĩa là lấy giới hạn từ ENV/mặc định; chỉnh ở **3 → 3** để đặt mức lớn hơn 0, tối đa 100 MB. `overrides` chứa các giá trị đã lưu qua menu, ưu tiên hơn ENV; dùng **3 → 8** để bỏ ghi đè và trả port/giới hạn về mặc định, giữ chế độ hiện tại.

### Thứ tự nạp và đồng bộ

Launcher mặc định chọn **Local không AWS** ở lần đầu, kể cả khi ENV cũ đang chọn AWS. Luôn xem bảng cấu hình trước khi chạy. Lựa chọn chỉ được lưu khi bạn chỉnh trên menu.

Thứ tự xử lý: **mặc định → file ENV → biến terminal → giá trị đã lưu của launcher → chế độ và các giá trị đồng bộ**.

- Backend: đọc `backend/.env`.
- Menu **3 → 10** chỉnh chế độ auth, User Pool và App client Cognito. S3 bắt buộc cognito; Local dùng dev khi chưa có cấu hình auth riêng. Không nhập token/mật khẩu ở menu cấu hình.
- Frontend: đọc `.env`, `.env.local`, `.env.development`, `.env.development.local` trong `frontend/`, theo thứ tự này. `.env.example` là tài liệu mẫu, không được tự nạp.
- Chế độ quyết định `VITE_UPLOAD_MODE`, storage và metadata. Launcher đồng bộ URL API, CORS của port frontend và giới hạn byte/MB. Không cần tạo `frontend/.env.local` để chạy bằng launcher.
- Nếu cả hai bên có giới hạn khác nhau, backend được ưu tiên; nếu backend không cấu hình riêng thì dùng frontend. Giá trị dung lượng bạn lưu trên launcher ưu tiên cả hai. Giữ quy ước hiện tại của app: 1 MB trong UI = 1.000.000 byte; tối đa 100 MB/tệp.
- Chỉ nạp các biến được ứng dụng hỗ trợ, không chuyển toàn bộ nội dung ENV sang frontend. Key/secret/token AWS từ terminal không được kế thừa vào các server. AWS của backend được chọn bằng profile; frontend không nhận cấu hình AWS.
- Các giá trị không ghi đè được đọc lại từ ENV mỗi lần chạy. Thay đổi cấu hình không thay đổi tiến trình đang chạy; menu nhắc khởi động lại.
- ENV hỗ trợ `KEY=value`, `export KEY=value`, BOM UTF-8, nháy đơn/đôi và comment. Không hỗ trợ giá trị nhiều dòng hoặc nội suy `${...}`: launcher báo rõ dòng cần sửa, không âm thầm nạp sai hoặc thực thi nội dung file.
- `launcher/runtime/settings.json` chỉ chứa các trường cấu hình cho phép, không chứa credentials. File lỗi được giữ để kiểm tra, không tự ghi đè mất dữ liệu.

Menu 3 → 5 chỉnh bucket cách ly; 3 → 9 chỉnh ARN workflow STANDARD. Hai giá trị được đọc từ .env/terminal/override giống các cấu hình khác. Khi chọn Local/Demo hoặc tắt pipeline, ARN hiệu lực để trống; giá trị đã lưu được giữ để dùng lại khi bật S3 pipeline.

Backend vẫn chạy bình thường bằng lệnh Uvicorn và `--env-file .env` khi không dùng launcher.

## AWS / profile

Menu **5** liệt kê tên và số lượng profile bằng `aws configure list-profiles`, phương thức xác thực và kết quả kiểm tra trong phiên launcher. Số profile không đồng nghĩa số tài khoản AWS.

- **Trình duyệt/Console:** `aws login --profile TEN`. Cần AWS CLI 2.32+ và quyền đăng nhập local development của danh tính IAM. Nếu profile cũ đang dùng key/SSO/role, chọn tên mới để tránh cấu hình xác thực trộn lẫn.
- **SSO:** `aws configure sso --profile TEN`; đăng nhập lại bằng `aws sso login --profile TEN`. Cần URL/region SSO và quyền do tổ chức cấp.
- **Access Key:** nhập bằng trường ẩn ngay trong terminal, có hỗ trợ Session Token. Cập nhật profile có sẵn yêu cầu gõ lại tên. Chỉ thay đổi phần profile được chọn trong file AWS, giữ profile khác. Chuyển sang key mới cũng loại token/phương thức cũ trong chính profile đó để tránh dùng nhầm.
- Profile và credentials được lưu theo AWS CLI: `%USERPROFILE%\.aws\config`, `%USERPROFILE%\.aws\credentials`, cache đăng nhập; có tôn trọng biến đường dẫn AWS tương ứng. Không nhập mật khẩu Console vào launcher.
- **Kiểm tra danh tính** dùng STS GetCallerIdentity với cả CLI và chính Python trong `backend/.venv`; chỉ xác nhận khi Account/ARN khớp. Mỗi lần bắt đầu chế độ AWS đều kiểm tra lại. Kết quả cũ trên menu không phải kiểm tra liên tục.
- Boto3 Console login cần CRT. Menu **4 → 5** bổ sung `botocore[crt]` đúng phiên bản botocore đang cài, không tự nâng toàn bộ SDK.
- **Kiểm tra tài nguyên** chỉ gọi S3 HeadBucket và DynamoDB DescribeTable; không upload, tạo bảng, xóa dữ liệu hay thay đổi IAM. Thiếu quyền mô tả không chứng minh ứng dụng không có quyền ghi. Các phép đọc này không nghiệm thu toàn pipeline.
- DynamoDB dùng `ap-southeast-2`; region S3 được cấu hình riêng. Pipeline chỉ bật trong S3 + DynamoDB và không điều khiển trigger AWS.

Luồng trình duyệt/SSO cần người dùng hoàn tất đăng nhập và các quyền AWS hợp lệ. Tài liệu: [Console login](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html), [SSO](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html), [login provider / CRT](https://docs.aws.amazon.com/sdkref/latest/guide/feature-login-credentials.html).

## Log và lỗi thường gặp

- Log API/WEB riêng, cài đặt riêng, trong `launcher/runtime/logs/`. Xem đuôi log qua menu 6 hoặc mở thư mục. Những mẫu key/token/password phổ biến được che; không bật debug hoặc thêm code ứng dụng tự in bí mật khi chia sẻ log.
- Port 5173/8000 đã bận: dừng đúng server cũ bằng terminal của nó hoặc đổi port trên launcher. Không tự chạy thêm server lên port khác.
- Backend khởi động lỗi: xem log API, cấu hình bucket/region/bảng và requirements. Launcher dừng các dịch vụ đã mở trong lượt khởi động lỗi.
- CLI dùng được, backend không dùng được: kiểm tra dependency/CRT, đúng profile và phiên còn hạn. Chọn đăng nhập lại nếu phiên hết hạn.
- Lỗi cài package do mạng, proxy hoặc quyền thư mục: xem log cài đặt và chạy lại bước đó sau khi khắc phục. Launcher không tự đổi quyền hệ thống, nâng SDK hàng loạt hay xóa môi trường cũ.
- Hệ thống tổ chức chặn Job Object: launcher báo lỗi và dọn tiến trình vừa tạo thay vì tiếp tục chạy server không được quản lý.

## Kiểm tra bằng dòng lệnh

Từ gốc project:

```powershell
.\MaySec.cmd --check
.\MaySec.cmd --show-config
.\MaySec.cmd --profiles
```

Ba lựa chọn trên không cài thư viện, không mở server và không xác thực/gọi AWS. `--check` trả mã 1 nếu có mục môi trường cần xử lý; AWS CLI không bắt buộc cho Local/Demo.

Không yêu cầu các script/test launcher cũ. Kiểm tra cấu hình bằng --show-config; chọn chế độ theo [hướng dẫn local](../docs/guides/local-development.md), nghiệm thu theo [kiểm tra hệ thống](../docs/operations/testing.md), triển khai cloud theo [hướng dẫn AWS](../docs/operations/aws-deployment.md).

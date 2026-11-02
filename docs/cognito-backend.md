# Tích hợp Cognito vào backend MâySec

Backend đã ghép lõi xác thực từ `feature/cognito-auth` commit `8a18733` vào nghiệp vụ của `AWS_Phong`. Upload, thư viện, quota, báo cáo quét, quét lại, yêu thích, nội dung, đổi tên, thùng rác, lịch sử upload và thông báo đều lấy owner từ access token đã xác minh. Frontend đăng nhập và API quản trị cách ly là các bước tiếp theo.

## Cấu hình backend

Thêm các dòng sau vào cấu hình service hoặc `backend/.env`, giữ các cấu hình S3/DynamoDB/pipeline đang dùng:

```dotenv
MAYSEC_AUTH_MODE=cognito
COGNITO_USER_POOL_ID=ap-southeast-2_ZgGsJVM2u
COGNITO_APP_CLIENT_ID=75a0p1bv9bihkmgrkrrbb6nk7p
```

Đây là định danh công khai. Backend không nhận mật khẩu và không cần App client secret. Cài `backend/requirements.txt`, khởi động lại API để nạp cấu hình. `MAYSEC_AUTH_MODE=dev` chỉ dùng Local/unconfigured; app từ chối cả cấu hình S3 và adapter S3 khi bật dev. Thiếu cấu hình Cognito không tự chuyển về dev.

Launcher đọc các biến này và cho chỉnh tại menu 3 → 10. Cấu hình launcher/terminal có thể ưu tiên hơn `.env`; kiểm tra bảng ENV hiệu lực nếu kết quả khác dự kiến. Frontend hiện chưa gửi Bearer token, vì vậy gọi backend Cognito bằng giao diện cũ sẽ bị từ chối.

## Danh tính và key S3

```text
uploads/<Cognito sub của user1>/<file_id>/report.pdf
uploads/<Cognito sub của user2>/<file_id>/report.pdf
uploads/<Cognito sub của admin>/<file_id>/report.pdf
```

Mỗi sub là UUID ổn định của tài khoản, độc lập username, email, nhóm admin/user và AWS CLI profile. Không tạo thư mục khi tạo tài khoản; prefix xuất hiện sau khi có object upload. `dev-user/` cũ giữ nguyên và không tự thuộc về tài khoản mới. Không sửa key hay chủ sở hữu dữ liệu cũ nếu chưa có phương án chuyển dữ liệu được thống nhất.

Không có tham số chọn owner. Backend dùng cùng owner đã xác minh cho S3, khóa DynamoDB, quota và audit. API dữ liệu người dùng chỉ phục vụ dữ liệu của chính tài khoản, kể cả khi vai trò là admin. Tệp ngoài phạm vi trả 404, cursor ngoài owner trả 400. Nội dung vẫn yêu cầu upload hoàn tất, scan safe và lifecycle active.

## Gọi API bằng access token

Lấy access token qua đăng nhập Cognito Authorization Code + PKCE. Không dùng ID token. Không ghi token vào Git, tài liệu hoặc log. Ví dụ PowerShell dưới đây yêu cầu dán token bằng lời nhắc ẩn và chỉ giữ trong bộ nhớ của phiên:

```powershell
$secureToken = Read-Host 'Cognito access token' -AsSecureString
$credential = [System.Net.NetworkCredential]::new('', $secureToken)
$authHeaders = @{ Authorization = 'Bearer ' + $credential.Password }
try {
    $baseUrl = 'http://127.0.0.1:8000'
    Invoke-RestMethod "$baseUrl/me" -Headers $authHeaders
    # PowerShell 7 hỗ trợ multipart qua -Form. Dùng đường dẫn tệp thử thực tế.
    $uploadFile = Get-Item -LiteralPath 'C:\duong-dan\report.pdf'
    Invoke-RestMethod "$baseUrl/upload" -Method Post -Headers $authHeaders -Form @{ file = $uploadFile }
    Invoke-RestMethod "$baseUrl/files" -Headers $authHeaders
    Invoke-RestMethod "$baseUrl/storage/usage" -Headers $authHeaders
} finally {
    $authHeaders.Clear()
    $credential.Password = ''
    $secureToken.Dispose()
    Remove-Variable authHeaders, credential, secureToken
}
```

Nếu đi qua proxy web cùng origin, dùng base URL `https://<hostname>/api`. Các route backend vẫn là `/me`, `/upload`, `/files`, không tự thêm prefix `/api` vào FastAPI.

Thiếu/sai/hết hạn access token trả 401 và `WWW-Authenticate: Bearer`; nhóm không hợp lệ trả 403. Thiếu cấu hình hoặc không tải được JWKS trả 503. `/health` không cần token và trả `auth_mode`/`owner_mode`. Swagger `/docs` hỗ trợ nút Authorize để nhập access token thử API.

## Quyền AWS cần chuẩn bị

Backend tiếp tục dùng credentials chain Boto3/profile/EC2 role hiện có. Cognito không tự cấp quyền S3 cho backend và không thay AWS CLI profile. Lõi xác minh JWT chỉ cần truy cập JWKS qua HTTPS, không cần quyền quản trị Cognito.

Policy phát triển `AWS/IAM/securedrive-db-dev-runtime-018913575473.json` hiện giới hạn dữ liệu vào dev-user. Trước nghiệm thu cloud, người quản lý IAM cần cập nhật scope cho các sub được sử dụng:

- Bảng `securedrive-files`: owner thật và các partition `!quota!<sub>`, `!history!<sub>`, `!notifications!<sub>`, giữ các action phục vụ quota/metadata/lifecycle hiện tại.
- Bucket nguồn: upload/read/abort multipart trong `uploads/<sub>/*`.
- ListBucketVersions và quyền xóa version: prefix của từng sub ở bucket nguồn/cách ly nếu dùng xóa vĩnh viễn.
- Bảng audit: quyền ghi/đọc hiện có. Quyền workflow rescan giữ theo policy hiện tại.

Với EC2 dùng chung một role, quyền AWS phải bao phủ các owner được phục vụ; kiểm quyền từng request nằm ở backend. Thay đổi này chưa sửa IAM đang triển khai, bucket, bảng, Lambda hay service EC2.

## Kiểm tra

Từ `backend/`, dùng `.venv/Scripts/python.exe -m pytest -q`. Các test dùng khóa RSA tạo trong test và S3/DynamoDB giả lập; không dùng token, tài khoản hay dữ liệu AWS thật. Thư mục tests giữ theo quy ước local-only hiện tại của repository.

Nghiệm thu thật: lần lượt đăng nhập hai user và một admin, gọi `/me`, upload, đối chiếu key và danh sách/quota riêng; thử truy cập ID tệp của user khác, token hết hạn, tài khoản không có nhóm và các thao tác vòng đời. Chỉ xem việc tách folder là đạt khi các request trái quyền cũng bị từ chối.

# Thiết lập xác thực Cognito

Nguồn: [cognito_auth.py](../../backend/app/services/cognito_auth.py), [auth frontend](../../frontend/src/auth). Danh tính, owner và quyền đọc theo [chính sách truy cập](../policies/access-control.md).

## Cấu hình backend

Thêm các dòng sau vào cấu hình service hoặc `backend/.env`, giữ các cấu hình S3/DynamoDB/pipeline đang dùng:

```dotenv
MAYSEC_AUTH_MODE=cognito
COGNITO_USER_POOL_ID=<User Pool thực tế>
COGNITO_APP_CLIENT_ID=<App client thực tế>
```

Đây là định danh công khai. Backend không nhận mật khẩu và không cần App client secret. Cài `backend/requirements.txt`, khởi động lại API để nạp cấu hình. `MAYSEC_AUTH_MODE=dev` chỉ dùng Local/unconfigured; app từ chối cả cấu hình S3 và adapter S3 khi bật dev. Thiếu cấu hình Cognito không tự chuyển về dev.

Launcher đọc các biến này và cho chỉnh tại menu 3 → 10, gồm cờ bật bộ chọn demo. Cấu hình launcher/terminal có thể ưu tiên hơn `.env`; kiểm tra bảng ENV hiệu lực nếu kết quả khác dự kiến. Frontend gửi Bearer token sau khi đăng nhập/chọn tài khoản.

## Đăng nhập trên web

Frontend dùng Authorization Code + PKCE. Cấu hình VITE_COGNITO_DOMAIN, VITE_COGNITO_APP_CLIENT_ID, VITE_COGNITO_REDIRECT_URI và VITE_COGNITO_LOGOUT_URI theo [tham chiếu cấu hình](../reference/configuration.md). Cho phép callback/logout URL tương ứng trong Cognito. Proxy phục vụ /callback bằng index.html và bỏ prefix /api khi chuyển request tới backend.

Backend xác minh JWT qua JWKS HTTPS, không cần client secret để xác minh. Các chức năng directory/hồ sơ/quản trị cần quyền AWS riêng; IAM theo [triển khai AWS](../operations/aws-deployment.md). Bộ chọn tài khoản không mật khẩu dùng [hướng dẫn demo](demo-login.md).

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


Nghiệm thu phân quyền bằng hai user và một admin theo [kiểm tra hệ thống](../operations/testing.md). Không chuyển owner dữ liệu cũ khi bật Cognito.

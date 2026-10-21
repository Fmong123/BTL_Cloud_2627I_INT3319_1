HƯỚNG DẪN CÀI ĐẶT MÔI TRƯỜNG & CHẠY LUỒNG UPLOAD AWS S3
Dự án: MaySec (Hệ thống lưu trữ tài liệu tự động phát hiện và cách ly thông tin nhạy cảm - Nhóm 4)
Nhánh làm việc: API_S3/upload
1. Tổng quan cập nhật trên nhánh API_S3/upload
Luồng tải tệp từ giao diện Mây4u (Frontend React/Vite) qua FastAPI Backend và đẩy trực tiếp lên AWS S3 thật đã được kết nối và kiểm thử thành công:

Hoàn thiện backend/app/services/s3_service.py: Hàm upload_to_s3 đã tuân thủ 100% S3Uploader Protocol trong s3_storage.py (sử dụng keyword-only arguments *, nhận client, bucket, content_type, transfer_config qua Dependency Injection, trả về chuỗi key và để Adapter xử lý ngoại lệ).
Kết nối điểm khởi động tại backend/app/main.py: Đã truyền s3_uploader=upload_to_s3 vào hàm khởi tạo app = create_app(s3_uploader=upload_to_s3).
Cấu trúc lưu trữ thực tế trên S3 (Lưu ý quan trọng cho Pipeline/Lambda):
Đường dẫn Object Key sinh ra có cấu trúc 4 cấp: uploads/<user_id>/<file_id>/<original_name>
Ví dụ thực tế: uploads/dev-user/f10f9c26-e723-432a-bad3-2ef2a7b0dbd3/test-s3-upload.txt
Ý nghĩa: Mỗi tệp khi tải lên sẽ được cấp một mã định danh <file_id> (UUID) riêng biệt làm thư mục cha. Do đó, mỗi tệp nằm trong một thư mục riêng trên S3 để tránh ghi đè khi trùng tên tệp. Khi viết Lambda (scan_file, encrypt_quarantine) bóc tách file_id từ key, cần lấy ở index 2 (key.split('/')[2]).
2. Yêu cầu công cụ cài đặt trước (Prerequisites)
Các thành viên cần đảm bảo máy tính đã cài đặt:

Python: Phiên bản 3.10 trở lên (khuyến nghị 3.11 hoặc 3.12).
Node.js & npm: Phiên bản 18+ (để chạy giao diện React + Vite).
Git: Đã kéo nhánh API_S3/upload mới nhất về máy:

git fetch origin

git checkout API_S3/upload

git pull origin API_S3/upload
3. Cấu hình và chạy Backend (FastAPI + Boto3 S3)
Bước 3.1: Cài đặt thư viện Python
Mở Terminal thứ nhất tại thư mục gốc của dự án và di chuyển vào thư mục backend:cd backend

pip install -r requirements.txt

(Nếu tạo môi trường ảo .venv, hãy kích hoạt .venv trước khi chạy pip install).
Bước 3.2: Thiết lập file backend/.env
Tạo hoặc mở file .env nằm trực tiếp trong thư mục backend/ (cùng cấp với requirements.txt). Đảm bảo có đầy đủ các biến môi trường sau:# BẮT BUỘC: Bật chế độ lưu trữ S3 thật (nếu thiếu biến này mặc định là unconfigured và trả lỗi 503)

MAYSEC_STORAGE_MODE=s3

# Thông tin Bucket và Region của dự án

S3_BUCKET_NAME=securedrive-project-int3319-018913575473-ap-southeast-2-an

AWS_REGION=ap-southeast-2

# Khóa truy cập AWS IAM (Lấy từ thông tin nội bộ của nhóm - TUYỆT ĐỐI KHÔNG COMMIT LÊN GIT)

AWS_ACCESS_KEY_ID=<nhập-access-key-id-của-nhóm>

AWS_SECRET_ACCESS_KEY=<nhập-secret-access-key-của-nhóm>

# Tuỳ chọn cấu hình Multipart Upload (đã có mặc định hợp lý trong config.py)

MAYSEC_S3_MULTIPART_THRESHOLD_BYTES=16777216

MAYSEC_S3_MULTIPART_CHUNKSIZE_BYTES=8388608

MAYSEC_S3_MAX_CONCURRENCY=2

Lưu ý: Trong config.py, biến vùng được đọc từ tên AWS_REGION (không có tiền tố MAYSEC_), trong khi chế độ lưu trữ bắt buộc phải là MAYSEC_STORAGE_MODE=s3.
Bước 3.3: Khởi động Backend Server
Đứng tại thư mục backend/, chạy lệnh:uvicorn app.main:app --reload --port 8000

Kiểm tra trạng thái Backend (Health Check): Mở trình duyệt truy cập địa chỉ local cổng 8000 (127.0.0.1:8000/health hoặc /docs). Kết quả trả về phải hiển thị "storage": "s3" và "storage_configured": true:

{

  "status": "ok",

  "storage": "s3",

  "storage_configured": true,

  "max_file_size_bytes": 104857600,

  "scan_status": "not_started"

}
4. Cấu hình và chạy Frontend (Giao diện Mây4u - React/Vite)
Bước 4.1: Cài đặt Node packages
Mở một cửa sổ Terminal thứ hai (giữ nguyên Terminal Backend đang chạy), di chuyển vào thư mục frontend:cd frontend

npm install
Bước 4.2: Thiết lập file frontend/.env để bật chế độ gọi API thật
Tạo hoặc cập nhật file .env trong thư mục frontend/ để giao diện chuyển từ chế độ mock sang gọi trực tiếp Backend API ở cổng 8000:v
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_USE_MOCK=false

*(Lưu ý: Điền đầy đủ giao thức `http://` vào trước địa chỉ `127.0.0.1:8000` và kiểm tra file `frontend/.env.example` hoặc `frontend/src/api/client.js` để đảm bảo đúng tên biến môi trường của Vite).*

### Bước 4.3: Khởi động Frontend Server

Đứng tại thư mục `frontend/`, chạy lệnh:

```bash

npm run dev

Terminal sẽ hiển thị đường dẫn chạy local tại cổng 5173 (127.0.0.1:5173).
5. Cách kiểm tra luồng Upload từ Giao diện lên AWS S3
Mở trình duyệt truy cập địa chỉ local của Vite tại 127.0.0.1:5173.
Quan sát trên giao diện Mây4u, xác nhận hiển thị nhãn "Chế độ API" ("Tệp gửi thật đến API — nhãn từng tệp cho biết local hay S3").
Bấm nút "Chọn tệp tải lên" (hoặc kéo thả một tệp .txt, .csv, .pdf dưới 100 MB vào trang).
Sau khi tải lên thành công:
Tệp sẽ xuất hiện trong danh sách với nhãn lưu trữ s3.
Phản hồi JSON từ API sẽ có dạng:

{

  "id": "f10f9c26-e723-432a-bad3-2ef2a7b0dbd3",

  "key": "uploads/dev-user/f10f9c26-e723-432a-bad3-2ef2a7b0dbd3/test-s3-upload.txt",

  "storage": "s3",

  "original_name": "test-s3-upload.txt",

  "size_bytes": 69,

  "content_type": "text/plain",

  "scan_status": "not_started"

}

Mở AWS S3 Console (Region: ap-southeast-2), truy cập bucket securedrive-project-int3319-018913575473-ap-southeast-2-an -> thư mục uploads/ -> <user_id>/ -> <file_id>/ sẽ thấy tệp vừa tải lên nằm trên Cloud.




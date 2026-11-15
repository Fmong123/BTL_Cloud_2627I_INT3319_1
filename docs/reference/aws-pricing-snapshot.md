# Snapshot cơ sở định giá AWS

Tài liệu giữ giả định đã lưu trong [billing-policy.json](../../backend/app/assets/billing-policy.json), checked_at=2026-11-07. Không cập nhật giá thị trường trong đợt hệ thống hóa tài liệu này. Đây là đầu vào dự toán của phiên bản chính sách, không xác nhận tài nguyên hoặc chi phí AWS hiện tại.

## Dữ liệu snapshot

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


Chính sách áp dụng cho người dùng ở [chi phí sử dụng](../policies/billing.md).

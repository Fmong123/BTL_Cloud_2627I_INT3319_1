# Source AWS MâySec

Hướng dẫn triển khai hiện hành: [handoff](../docs/AWS-HANDOFF-QUICKSTART-2026-10-31.md). Quyền/dữ liệu/lỗi: [phụ lục](../docs/AWS-HANDOFF-2026-10-31.md). Lưu ý triển khai: [DEPLOYMENT.md](DEPLOYMENT.md).

## Các gói Lambda

| Source | Lambda / ZIP |
| --- | --- |
| Lambda_AWS/scan_file/handler.py | securedrive-scan-pii |
| Lambda_AWS/quarantine/handler.py | securedrive-quarantine-file |
| Lambda_AWS/notification/handler.py | securedrive-notify |
| Lambda_AWS/trash_cleanup/handler.py | securedrive-trash-cleanup |

Handler cả bốn: handler.lambda_handler. Ba pipeline ZIP có handler.py + pipeline_common.py ở gốc; cleanup có handler.py + app/. Không upload ZIP bàn giao tổng vào Lambda.

## Đóng gói từ thư mục gốc repo

Script đóng gói chỉ giữ local, được `.gitignore` loại khỏi Git. Các lệnh dưới đây dành cho máy có sẵn `AWS/package_lambdas.py`; bản clone mới dùng source và các ZIP đã bàn giao, không tự có script này.

```powershell
python AWS/package_lambdas.py
python AWS/package_lambdas.py --check
```

Lệnh thứ nhất tạo cả bốn ZIP Lambda trong AWS/build từ source hiện tại, chỉ lấy file Python cần đóng gói. Lệnh thứ hai kiểm tra nội dung ZIP khớp source, báo lỗi nếu thiếu/cũ. Đóng gói lại sau khi sửa Lambda, pipeline_common.py hoặc backend dùng trong cleanup. Frontend/backend, policy và workflow bàn giao từ cùng commit của repository; không dùng lại gói tổng cũ làm source hiện hành.

Builder chỉ tạo file local, không cấp quyền/deploy AWS và không thu thập .env, credentials hoặc dữ liệu upload. Test trong backend/tests và frontend/tests cũng chỉ giữ local, không thay cho nghiệm thu OCR/quarantine/SNS trên AWS.

## Cấu hình cần giữ khớp

- Backend dùng DYNAMODB_FILES_TABLE/DYNAMODB_AUDIT_TABLE; Lambda dùng FILES_TABLE/AUDIT_TABLE, giá trị phải cùng bảng.
- Scan: STRICT_DB_WRITE=true, layer PDF/Textract phù hợp. Upload tối đa 100 MB; Scan mặc định tối đa 52.428.800 byte, OCR ảnh 10 MiB.
- Quarantine: bucket và KMS_KEY_ID thật (ARN/UUID). Notify: SNS_TOPIC_ARN, webhook nếu dùng.
- Cleanup: FILES_TABLE, UPLOAD_BUCKET, QUARANTINE_BUCKET; role riêng và Logs.
- Orchestration/State_machine.json là workflow STANDARD để đối chiếu; mẫu trash-cleanup-schedule.example.yaml mặc định DISABLED, chỉ bật sau nghiệm thu.
- IAM/ chứa policy theo từng principal/role. Thay placeholder và đối chiếu ARN trước khi áp dụng; giữ trust policy và key policy đang cần.

Không tạo lại bảng hay reset dữ liệu để thêm thuộc tính. Mỗi thay đổi trên AWS phải đối chiếu bản đang chạy, sao lưu và nghiệm thu theo handoff.

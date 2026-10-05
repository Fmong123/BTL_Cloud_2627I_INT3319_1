import os
from dotenv import load_dotenv
import json

# Nạp Access Key từ file .env để boto3 có quyền tải file từ S3 về máy tính
load_dotenv()

# Import hàm lambda_handler từ file lambda_function.py em vừa viết
from lambda_function import lambda_handler

if __name__ == "__main__":
    # Giả lập payload y hệt bản Handoff của AWS-A gửi cho em
    mock_event = {
        "detail": {
            "bucket": { 
                "name": os.getenv('S3_BUCKET_NAME') 
            },
            "object": { 
                # Chú ý: Thay tên file này bằng đúng đường dẫn file test trên S3 của nhóm em
                "key": "test_log_giaodich.txt" 
            }
        }
    }

    print("🚀 Bắt đầu giả lập Step Functions gọi Lambda...\n")
    
    # Gọi hàm với event giả lập, context để trống (None)
    result = lambda_handler(mock_event, None)
    
    print("\n📦 Kết quả Output trả về cho Step Functions:")
    print(json.dumps(result, indent=2, ensure_ascii=False))
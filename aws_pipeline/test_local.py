import os
from dotenv import load_dotenv
import json

# Nạp Access Key từ file .env để boto3 có quyền tải file từ S3 về máy tính
load_dotenv()

# Import hàm lambda_handler từ file lambda_function.py
from lambda_function import lambda_handler

if __name__ == "__main__":
    mock_event = {
        "detail": {
            "bucket": { 
                "name": os.getenv('S3_BUCKET_NAME') 
            },
            "object": { 
                "key": "test_log_giaodich.txt" 
            }
        }
    }

    print("🚀 Bắt đầu giả lập Step Functions gọi Lambda...\n")
    
    # Gọi hàm với event giả lập, context để trống (None)
    result = lambda_handler(mock_event, None)
    
    print("\n📦 Kết quả Output trả về cho Step Functions:")
    print(json.dumps(result, indent=2, ensure_ascii=False))

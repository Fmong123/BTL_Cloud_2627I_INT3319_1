import boto3
import os
from botocore.exceptions import ClientError
from dotenv import load_dotenv

# Nạp các biến môi trường từ file .env
load_dotenv()

AWS_ACCESS_KEY_ID = os.getenv('AWS_ACCESS_KEY_ID')
AWS_SECRET_ACCESS_KEY = os.getenv('AWS_SECRET_ACCESS_KEY')
AWS_REGION = os.getenv('AWS_REGION')
S3_BUCKET_NAME = os.getenv('S3_BUCKET_NAME')

# Khởi tạo client kết nối với dịch vụ S3
s3_client = boto3.client(
    's3',
    aws_access_key_id=AWS_ACCESS_KEY_ID,
    aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
    region_name=AWS_REGION
)

def upload_to_s3(file_path, bucket_name, object_name=None):
    """
    Tải một file cục bộ lên Amazon S3 bucket
    """
    # Nếu không truyền object_name, hệ thống sẽ lấy tên gốc của file
    if object_name is None:
        object_name = os.path.basename(file_path)

    try:
        print(f"Đang tải '{file_path}' lên bucket '{bucket_name}'...")
        s3_client.upload_file(file_path, bucket_name, object_name)
        print("✅ Tải file lên thành công!")
        return True
    except ClientError as e:
        print(f"❌ Lỗi trong quá trình tải file: {e}")
        return False

if __name__ == '__main__':
    # 1. Tạo một file log test để tải lên
    test_file_name = "test_log_giaodich.txt"
    with open(test_file_name, "w", encoding="utf-8") as f:
        f.write("Đây là file test upload từ module AWS-B bằng boto3.\n")
        f.write("Nội dung giả lập: 4111 1111 1111 1111 (Visa Test)")
    
    # 2. Gọi hàm upload_to_s3 để chạy test độc lập
    upload_to_s3(test_file_name, S3_BUCKET_NAME)
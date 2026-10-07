import boto3
from botocore.exceptions import ClientError
import os
from dotenv import load_dotenv

# Backend sử dụng FastAPI nên sẽ tự động quản lý load biến môi trường
load_dotenv()

S3_BUCKET_NAME = os.getenv('S3_BUCKET_NAME')
AWS_REGION = os.getenv('AWS_REGION')

# Khởi tạo client S3
s3_client = boto3.client(
    's3',
    region_name=AWS_REGION,
    # Cấu hình signature_version để đảm bảo url tương thích tốt nhất với presigned
    config=boto3.session.Config(signature_version='s3v4')
)

def generate_upload_url(object_name, expiration=3600):
    """
    Tạo Presigned URL để Frontend tự tải file trực tiếp lên S3
    :param object_name: Tên file trên S3 (vd: uploads/123/file.txt)
    :param expiration: Thời gian sống của URL tính bằng giây (mặc định 1 tiếng)
    :return: Chuỗi URL hoặc None nếu lỗi
    """
    try:
        response = s3_client.generate_presigned_url(
            'put_object',
            Params={
                'Bucket': S3_BUCKET_NAME,
                'Key': object_name
            },
            ExpiresIn=expiration
        )
        print(f"✅ Đã tạo Presigned URL cho file: {object_name}")
        return response
    except ClientError as e:
        print(f"❌ Lỗi khi tạo presigned URL: {e}")
        return None
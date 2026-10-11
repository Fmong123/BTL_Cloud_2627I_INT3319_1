import boto3
from botocore.exceptions import ClientError
import os
from dotenv import load_dotenv

load_dotenv()

S3_BUCKET_NAME = os.getenv('S3_BUCKET_NAME')
AWS_REGION = os.getenv('AWS_REGION')

s3_client = boto3.client(
    's3',
    region_name=AWS_REGION
)

def upload_to_s3(file_obj, object_name):
    """
    Hàm nhận file stream từ Backend và upload trực tiếp lên S3
    :param file_obj: Đối tượng file được đọc từ request của Frontend
    :param object_name: Tên file/Đường dẫn file khi lưu trên S3 (vd: uploads/id/file.txt)
    :return: True nếu upload thành công, False nếu thất bại
    """
    try:
        # Upload trực tiếp file stream thay vì dùng đường dẫn local
        s3_client.upload_fileobj(file_obj, S3_BUCKET_NAME, object_name)
        print(f"✅ Đã upload thành công {object_name} lên S3")
        return True
    except ClientError as e:
        print(f"❌ Lỗi upload S3: {e}")
        return False
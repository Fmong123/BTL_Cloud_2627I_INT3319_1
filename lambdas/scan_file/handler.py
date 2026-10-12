import json
import boto3
import re
import urllib.parse

# Khởi tạo client S3 (Trên AWS Lambda, boto3 sẽ tự động dùng IAM Role, không cần key)
s3_client = boto3.client('s3')

# Định nghĩa các mẫu Regex phát hiện dữ liệu nhạy cảm
PATTERNS = {
    "CREDIT_CARD": r'\b(?:\d{4}[ -]?){3}\d{4}\b', # Định dạng thẻ 16 số
    "CCCD_VN": r'\b0\d{2}[0-3]\d{2}\d{6}\b'      # Định dạng CCCD 12 số, bắt đầu bằng 0
}

def lambda_handler(event, context):
    """
    Hàm xử lý chính được AWS Lambda gọi khi có sự kiện từ Step Functions
    """
    try:
        # 1. Trích xuất thông tin từ event payload theo chuẩn của AWS-A
        bucket_name = event["detail"]["bucket"]["name"]
        
        # urllib.parse giúp xử lý các tên file có khoảng trắng hoặc ký tự đặc biệt
        object_key = urllib.parse.unquote_plus(event["detail"]["object"]["key"])
        
        print(f"Đang tiến hành quét file: {object_key} trong bucket: {bucket_name}")

        # 2. Đọc nội dung file trực tiếp từ S3 vào bộ nhớ
        response = s3_client.get_object(Bucket=bucket_name, Key=object_key)
        file_content = response['Body'].read().decode('utf-8')

        # 3. Tiến hành quét PII
        findings = []
        for pii_type, pattern in PATTERNS.items():
            # Tìm tất cả các chuỗi khớp với regex
            matches = re.finditer(pattern, file_content)
            for match in matches:
                findings.append({
                    "type": pii_type,
                    "location": f"Ký tự thứ {match.start()} đến {match.end()}"
                })

        # 4. Trả kết quả chuẩn xác theo format Handoff của AWS-A
        if len(findings) > 0:
            print(f"🚨 Phát hiện {len(findings)} rò rỉ dữ liệu!")
            return {
                "status": "flagged",
                "findings": findings
            }
        else:
            print("✅ File an toàn, không chứa PII.")
            return {
                "status": "safe",
                "findings": []
            }

    except Exception as e:
        print(f"❌ Lỗi xử lý: {str(e)}")
        # Trả về an toàn tạm thời hoặc quăng lỗi tuỳ thuộc vào quy trình SOC
        return {
            "status": "error",
            "findings": [{"type": "SYSTEM_ERROR", "location": str(e)}]
        }
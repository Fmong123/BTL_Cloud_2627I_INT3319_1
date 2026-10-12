def upload_to_s3(file_obj, key, content_type, client, bucket, transfer_config):
    """
    Hàm upload S3 chuẩn Dependency Injection theo contract của adapter.
    Không khởi tạo client hay bucket toàn cục, sử dụng hoàn toàn tham số được truyền vào.
    """
    # Chuẩn bị các tham số bắt buộc
    kwargs = {
        'Fileobj': file_obj,
        'Bucket': bucket,
        'Key': key
    }
    
    # Bổ sung ContentType vào ExtraArgs nếu có (Khắc phục lỗi 4)
    if content_type:
        kwargs['ExtraArgs'] = {'ContentType': content_type}
        
    # Bổ sung Config tải nhiều phần (multipart) nếu có (Khắc phục lỗi 4)
    if transfer_config:
        kwargs['Config'] = transfer_config

    # Gọi hàm upload của boto3. 
    # KHÔNG dùng try-except ở đây để Exception tự đẩy ra ngoài cho Adapter bắt (Khắc phục lỗi 5)
    client.upload_fileobj(**kwargs)
    
    # Trả về chuỗi key đúng chuẩn (Khắc phục lỗi 2)
    return key
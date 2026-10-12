def upload_to_s3(
    file_obj,
    *,
    key: str,
    content_type: str,
    client,
    bucket: str,
    transfer_config,
) -> str:
    """
    Uploader tuân thủ S3Uploader Protocol (s3_storage.py).

    - file_obj   : positional — file-like object đã được rewind bởi caller (files.py:52).
    - key/content_type/client/bucket/transfer_config : keyword-only theo Protocol.
    - Trả về đúng chuỗi `key` không đổi để Adapter xác nhận tại dòng 86.
    - Không bắt exception — Adapter (s3_storage.py:78-84) đã xử lý toàn bộ.
    """
    kwargs = {
        "Fileobj": file_obj,
        "Bucket": bucket,
        "Key": key,
    }

    if content_type:
        kwargs["ExtraArgs"] = {"ContentType": content_type}

    if transfer_config:
        kwargs["Config"] = transfer_config

    client.upload_fileobj(**kwargs)

    return key

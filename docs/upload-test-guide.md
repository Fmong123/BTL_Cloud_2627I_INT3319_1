# Kiểm tra upload local và S3

Cài/chạy theo [API guide](api-guide.md). Endpoint/giới hạn theo [API contract](api-contract.md); triển khai cloud theo [handoff](AWS-HANDOFF-QUICKSTART-2026-10-31.md).

## Kiểm tra local

1. Chọn Local không AWS trong MaySec.cmd, hoặc đặt storage=local, metadata=disabled, pipeline=false và ARN rescan trống trong backend/.env.
2. Mở /health, kiểm storage=local, max_file_size_bytes=100000000; mở /docs hoặc web frontend.
3. Chọn một tệp nhỏ có nội dung. API trả 201 sau khi lưu xong. Key trong response nằm dưới backend/data/ nếu chưa đổi storage root.
4. So SHA256 file gốc với file ở đúng key local bằng Get-FileHash. Metadata disabled không cung cấp thư viện/preview/quét trên server.
5. Thử file rỗng và tệp vượt cấu hình để kiểm 400/413. Không cần tạo file 100 MB: có thể hạ giới hạn trong môi trường test rồi trả lại 100000000 và restart.

## Kiểm tra S3 + DynamoDB

1. Áp dụng cấu hình/quyền trong handoff, xác minh principal và bucket thật. Không tắt IAM hoặc xóa dữ liệu dùng chung để ép lỗi.
2. Upload tệp tổng hợp được phép; đối chiếu id/key/size_bytes giữa API, DynamoDB và object version trên S3.
3. Bật pipeline chỉ sau khi ba Lambda/workflow sẵn sàng. Kiểm riêng kết quả scan, cách ly và thông báo; 201 không phải kết quả an toàn.
4. Với tệp safe, thử preview/download và so nội dung. Thử đổi tên/rác/restore/purge; quota chỉ giảm sau xóa hoàn tất.
5. Có thể thử tệp trên ngưỡng multipart 16 MiB nhưng phải dưới 100 MB; giới hạn Scan mặc định riêng là 52.428.800 byte, không cam kết quét mọi tệp upload 100 MB.

Sau timeout/hủy hoặc kết quả unknown, đối soát file ID trước khi gửi lại. Không tự giảm reservation. Script/test cũ không cần khôi phục; kiểm tra tự động hiện hành là pytest trong backend và npm test/build/test:ui trong frontend. Các bộ này không nghiệm thu AWS thật.

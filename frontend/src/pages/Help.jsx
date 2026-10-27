import { Link } from 'react-router-dom';
import { ArrowRight, CloudUpload, Search, ShieldCheck } from 'lucide-react';
const guides = [
  [
    CloudUpload,
    'Tải tệp đầu tiên',
    'Dùng nút “Tải tệp lên” ở góc trên hoặc kéo thả tệp vào web. Bạn có thể chọn nhiều tệp; tối đa 5 tệp được truyền song song, các tệp còn lại xếp hàng.',
    '/overview',
    'Thêm tệp',
  ],
  [
    Search,
    'Tìm và sắp xếp tệp',
    'Gõ “bao cao” vẫn tìm được “Báo cáo.pdf”. Lọc loại, trạng thái hoặc tệp đánh dấu; chọn nhiều để thao tác cùng lúc.',
    '/files',
    'Mở danh sách',
  ],
  [
    ShieldCheck,
    'Hiểu kết quả xử lý',
    'Tải lên, quét và cách ly là các bước riêng. Mở bảng chi tiết để xem kết quả quét và lý do cần xử lý; tệp chưa quét không được coi là an toàn.',
    '/files?area=attention',
    'Xem tệp cần xử lý',
  ],
];
export default function Help() {
  return (
    <>
      <p className="page-intro">Một vài điều để bắt đầu và thao tác thoải mái hơn.</p>
      <div className="guide-grid">
        {guides.map(([Icon, title, description, to, label], index) => (
          <article className="guide" key={title}>
            <span className="guide-number">0{index + 1}</span>
            <Icon size={27} />
            <h2>{title}</h2>
            <p>{description}</p>
            <Link className="text-button" to={to}>
              {label}
              <ArrowRight size={16} />
            </Link>
          </article>
        ))}
      </div>
      <section className="settings-section faq">
        <h2>Khi bạn cần trợ giúp</h2>
        <details open>
          <summary>Danh sách tệp được lấy từ đâu?</summary>
          <p>
            Với Lưu trữ thật và metadata đã bật, web gọi FastAPI GET /files; backend đọc metadata
            trong DynamoDB rồi trả danh sách. Web không truy cập AWS trực tiếp. Nội dung tệp nằm
            trên S3 hoặc storage local. Bạn có thể làm mới để đọc lại danh sách sau khi tải lại
            trang. Nếu metadata chưa bật, chỉ tệp đã tải trong phiên hiện tại được hiển thị. Chế độ
            Trải nghiệm không gọi API và mất danh sách khi refresh.
          </p>
        </details>
        <details>
          <summary>Khu thường và Cần xử lý / Cách ly khác nhau thế nào?</summary>
          <p>
            Khu thường gồm tệp chưa quét, đang quét hoặc không phát hiện dữ liệu nhạy cảm. Tệp phát
            hiện dữ liệu, không quét được, lỗi xử lý hoặc đã cách ly nằm ở khu Cần xử lý / Cách ly.
            Tệp tự chuyển khu theo trạng thái máy chủ; không có thao tác upload thẳng vào bucket
            cách ly.
          </p>
        </details>
        <details>
          <summary>Upload thất bại thì làm gì?</summary>
          <p>
            Xem lý do ở tệp hoặc trang Hoạt động xử lý. Tệp rỗng/quá giới hạn cần chọn tệp khác. Nếu
            máy chủ chưa xác nhận chắc chắn đã lưu hay chưa, web kiểm tra lại trạng thái thay vì tự
            gửi lại. Tệp đọc từ thư viện không có bản gốc trong trình duyệt nên không có nút thử lại
            upload.
          </p>
          <Link className="text-button" to="/uploads">
            Xem hoạt động xử lý <ArrowRight size={14} />
          </Link>
        </details>
        <details>
          <summary>“Bỏ khỏi danh sách” và “Hủy tải” có xóa tệp không?</summary>
          <p>
            Bỏ khỏi danh sách chỉ áp dụng cho hoạt động upload cục bộ trong phiên, có thể hoàn tác
            trong 8 giây; không xóa bản ghi thư viện hoặc nội dung trên máy chủ. Hủy chỉ ngắt yêu
            cầu phía trình duyệt, không bảo đảm máy chủ chưa ghi tệp.
          </p>
        </details>
        <details>
          <summary>Đã tải xong có nghĩa là tệp an toàn?</summary>
          <p>
            Không. Tải lên hoàn tất chỉ có nghĩa nội dung được xác nhận lưu. Web tự đọc trạng thái
            quét từ API. “An toàn” là kết quả của lần quét PII, không phải
            bảo đảm tệp hoàn toàn an toàn hoặc không có mã độc. “Phát hiện dữ liệu” chưa có nghĩa
            cách ly xong; “Chưa xóa được bản nguồn” cần được xử lý tiếp.
          </p>
        </details>
        <details>
          <summary>Tại sao kết quả quét chưa thay đổi?</summary>
          <p>
            Quét diễn ra trên pipeline của máy chủ. Web kiểm tra định kỳ khi tab đang mở và có mạng;
            không tự kích hoạt quét lại. Mở bảng chi tiết rồi chọn Kiểm tra lại để đọc trạng thái
            mới. Hết thời gian theo dõi hoặc lỗi mạng không được coi là kết quả scan lỗi.
          </p>
        </details>
        <details>
          <summary>Thông báo được giữ bao lâu?</summary>
          <p>
            Biểu tượng chuông giữ các cập nhật mới mà web quan sát trong phiên, gồm upload, quét và
            cách ly. Có thể lọc chưa đọc hoặc cần chú ý. Dữ liệu nạp lần đầu không tạo một loạt
            thông báo cũ; refresh sẽ xóa lịch sử thông báo cục bộ. Bảng này không thay thế audit log
            trên máy chủ.
          </p>
        </details>
        <details>
          <summary>Có phím tắt và dark mode không?</summary>
          <p>
            Dùng Ctrl+K để chuyển đến tìm kiếm khi không đang nhập ở ô khác. Tab để di chuyển giữa
            các nút, Escape để đóng bảng chi tiết hoặc hộp thoại. Đổi Sáng / Tối / Theo hệ thống ở
            biểu tượng giao diện góc trên hoặc trong Cài đặt.
          </p>
        </details>
      </section>
    </>
  );
}

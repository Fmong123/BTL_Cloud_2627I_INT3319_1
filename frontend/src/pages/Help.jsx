import { Link } from 'react-router-dom';
import { ArrowRight, CloudUpload, Search, ShieldCheck } from 'lucide-react';
const guides = [
  [
    CloudUpload,
    'Tải tệp đầu tiên',
    'Dùng nút “Tải tệp lên” ở góc trên hoặc kéo thả tại Tổng quan / Tệp của tôi. Bạn có thể chọn nhiều tệp; MâySec sẽ tải lần lượt.',
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
    'Chọn đúng nơi lưu',
    'Chế độ Trải nghiệm không gửi nội dung tệp. Lưu trữ thật gửi đến máy chủ đã chọn; nhãn trên từng tệp cho biết local hay S3 được xác nhận.',
    '/settings',
    'Cài đặt lưu trữ',
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
          <summary>Tại sao tải lại trang không còn danh sách?</summary>
          <p>
            Danh sách và lịch sử tải chỉ nằm trong phiên trình duyệt. Chuyển trang trong MâySec vẫn
            giữ chúng; refresh bắt đầu phiên mới. Tệp đã lưu thật không tự bị xóa trên máy chủ,
            nhưng phiên bản này chưa có chức năng lấy lại danh sách từ máy chủ.
          </p>
        </details>
        <details>
          <summary>Upload thất bại thì làm gì?</summary>
          <p>
            Xem lý do ở tệp hoặc trang Hoạt động. Tệp rỗng/quá giới hạn cần chọn tệp khác. Với lỗi
            mạng, kiểm tra kết nối rồi thử lại. Nếu timeout, kiểm tra tệp trên máy chủ trước khi gửi
            lại để tránh bản sao.
          </p>
          <Link className="text-button" to="/uploads">
            Xem hoạt động tải lên <ArrowRight size={14} />
          </Link>
        </details>
        <details>
          <summary>“Bỏ khỏi danh sách” và “Hủy tải” có xóa tệp không?</summary>
          <p>
            Bỏ khỏi danh sách chỉ ẩn bản ghi trong phiên, có thể hoàn tác trong 8 giây. Hủy chỉ ngắt
            yêu cầu phía trình duyệt, không bảo đảm máy chủ chưa ghi tệp.
          </p>
        </details>
        <details>
          <summary>Đã tải xong có nghĩa là tệp an toàn?</summary>
          <p>
            Không. Trạng thái upload chỉ cho biết máy chủ xác nhận lưu. Kết quả quét dữ liệu nhạy
            cảm chưa được tích hợp vào giao diện; không suy ra tệp an toàn từ dấu hoàn tất.
          </p>
        </details>
        <details>
          <summary>Có phím tắt và dark mode không?</summary>
          <p>
            Dùng Ctrl+K để chuyển đến tìm kiếm khi không đang nhập ở ô khác. Tab để di chuyển giữa
            các nút, Escape để đóng hộp thoại. Đổi Sáng / Tối / Theo hệ thống ở biểu tượng giao diện
            góc trên hoặc trong Cài đặt.
          </p>
        </details>
      </section>
    </>
  );
}

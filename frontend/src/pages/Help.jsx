import { Link } from 'react-router-dom';
import { ArrowRight, CloudUpload, Search, ShieldCheck } from 'lucide-react';
const guides = [
  [
    CloudUpload,
    'Tải tệp đầu tiên',
    'Dùng nút “Tải tệp lên” trong thanh công cụ danh sách hoặc kéo thả tệp vào web. Bạn có thể chọn nhiều tệp; tối đa 5 tệp được truyền song song, các tệp còn lại xếp hàng.',
    '/files',
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
        <details>
          <summary>Làm sao xem trước hoặc tải xuống tệp?</summary>
          <p>
            Bấm nút “Xem” cạnh tên ảnh/PDF hoặc bấm tên tệp để mở xem trước; các tệp khác mở bảng
            thông tin. Xem trước và tải xuống chỉ được bật khi máy chủ hỗ trợ đọc nội dung, tệp đã
            tải lên và có kết quả “Không phát hiện”. Tệp đang quét, có cảnh báo hoặc đã cách ly chỉ
            xem được thông tin. PNG/JPEG/GIF/WebP tối đa 10 MB, PDF 20 MB, văn bản UTF-8
            TXT/CSV/JSON 1 MB có thể xem trước. Định dạng khác hoặc tệp lớn hơn giới hạn xem trước
            có thể tải xuống khi đủ điều kiện.
          </p>
          <p>
            Trên trình duyệt hỗ trợ, nút “Tải xuống” mở hộp thoại Save As để chọn thư mục và tên
            tệp; bấm Hủy sẽ dừng thao tác. Chức năng này cần HTTPS hoặc localhost. Trình duyệt khác
            dùng cách tải thông thường; bật “Hỏi nơi lưu từng tệp” trong cài đặt tải xuống nếu muốn
            luôn chọn thư mục.
          </p>
        </details>
        <details>
          <summary>Có thể thu gọn thanh điều hướng và thử lại một đợt tải không?</summary>
          <p>
            Dùng nút Thu gọn thanh điều hướng ở sidebar để tăng diện tích danh sách. Khi thu gọn, rê
            chuột hoặc dùng bàn phím để đọc tên các biểu tượng. Trang Hoạt động xử lý nhóm mỗi lần
            chọn/thả tệp thành một đợt được ghi nhớ; nút thử lại chỉ gửi những tệp lỗi/đã hủy còn
            bản gốc và được phép thử lại, không gửi lại tệp đã xong hoặc chưa rõ kết quả.
          </p>
        </details>
        <details open>
          <summary>Danh sách tệp được lấy từ đâu?</summary>
          <p>
            Với Lưu trữ thật và metadata đã bật, web gọi FastAPI GET /files; backend đọc metadata
            trong DynamoDB rồi trả danh sách. Web không truy cập AWS trực tiếp. Nội dung tệp nằm
            trên S3 hoặc storage local. Bạn có thể làm mới để đọc lại danh sách sau khi tải lại
            trang. Nếu metadata chưa bật, lịch sử chỉ lưu trên trình duyệt này. Chế độ Trải nghiệm
            không gọi API và chỉ lưu thông tin mô phỏng, không lưu nội dung tệp.
          </p>
        </details>
        <details>
          <summary>Đổi tên và Thùng rác hoạt động thế nào?</summary>
          <p>
            Trong menu ba chấm của tệp, chọn Đổi tên hoặc Chuyển vào Thùng rác. Đổi tên không thay
            đổi nội dung hay kết quả quét. Tệp trong Thùng rác vẫn tính vào 1 GB, có thể khôi phục
            trong 30 ngày và vẫn giữ trạng thái cách ly. Xóa vĩnh viễn cần xác nhận, chỉ giải phóng
            dung lượng khi máy chủ xóa hết nội dung và các phiên bản. Nếu xóa chưa hoàn tất, chọn
            xóa lại; tệp chờ xóa không thể khôi phục. Tác vụ dọn tự động cần được bật trên máy chủ.
          </p>
        </details>
        <details>
          <summary>Khu thường và Cần xử lý / Cách ly khác nhau thế nào?</summary>
          <p>
            Khu thường gồm tệp chưa quét, đang quét hoặc không phát hiện dữ liệu nhạy cảm. Tệp phát
            hiện dữ liệu, không quét được, lỗi xử lý hoặc đã cách ly nằm ở khu Cần xử lý / Cách ly.
            Tệp tự chuyển khu theo trạng thái máy chủ; không có thao tác tải lên thẳng vào bucket
            cách ly.
          </p>
        </details>
        <details>
          <summary>Tải lên thất bại thì làm gì?</summary>
          <p>
            Xem lý do ở tệp hoặc trang Hoạt động xử lý. Tệp rỗng/quá giới hạn cần chọn tệp khác. Nếu
            máy chủ chưa xác nhận chắc chắn đã lưu hay chưa, web kiểm tra lại trạng thái thay vì tự
            gửi lại. Tệp đọc từ thư viện không có bản gốc trong trình duyệt nên không có nút thử lại
            tải lên.
          </p>
          <Link className="text-button" to="/uploads">
            Xem hoạt động xử lý <ArrowRight size={14} />
          </Link>
        </details>
        <details>
          <summary>“Bỏ khỏi danh sách” và “Hủy tải” có xóa tệp không?</summary>
          <p>
            Bỏ khỏi danh sách chỉ áp dụng cho hoạt động tải lên cục bộ trong phiên, có thể hoàn tác
            trong 8 giây; không xóa bản ghi thư viện hoặc nội dung trên máy chủ. Hủy chỉ ngắt yêu
            cầu phía trình duyệt, không bảo đảm máy chủ chưa ghi tệp.
          </p>
        </details>
        <details>
          <summary>Đã tải xong có nghĩa là tệp an toàn?</summary>
          <p>
            Không. Tải lên hoàn tất chỉ có nghĩa nội dung được xác nhận lưu. Web tự đọc trạng thái
            quét từ API. “Không phát hiện” nghĩa là chưa phát hiện dữ liệu nhạy cảm, không phải bảo
            đảm tệp hoàn toàn an toàn hoặc không có mã độc. “Phát hiện dữ liệu” chưa có nghĩa cách
            ly xong; “Chưa xóa được bản nguồn” cần được xử lý tiếp.
          </p>
        </details>
        <details>
          <summary>Tại sao kết quả quét chưa thay đổi?</summary>
          <p>
            Quét diễn ra trên pipeline của máy chủ. Web kiểm tra định kỳ khi tab đang mở và có mạng;
            không tự kích hoạt quét lại. Mở bảng chi tiết rồi chọn Cập nhật trạng thái để đọc trạng
            thái mới. Hết thời gian theo dõi hoặc lỗi mạng không được coi là kết quả scan lỗi.
          </p>
          <p>
            Trong chi tiết tệp, chọn Báo cáo quét để xem số lượng theo loại và mức độ đọc đủ nội
            dung. Quét lại tệp gửi một lượt xử lý mới khi dịch vụ đã bật; tệp đang xử lý hoặc cách
            ly không thể quét lại tại đây. Mỗi lượt mới cách nhau tối thiểu 60 giây.
          </p>
        </details>
        <details>
          <summary>Hạn mức 1 GB được tính thế nào?</summary>
          <p>
            Gói miễn phí có 1 GB, mỗi tệp tối đa 100 MB. Tệp cách ly và tệp trong Thùng rác vẫn được
            tính vào dung lượng. Máy chủ giữ chỗ cho tệp đang tải hoặc chưa xác nhận kết quả, và từ
            chối lượt tải vượt dung lượng còn lại. Sidebar hiển thị riêng dung lượng đã dùng và đang
            giữ chỗ.
          </p>
        </details>
        <details>
          <summary>Thông báo được giữ bao lâu?</summary>
          <p>
            Biểu tượng chuông giữ các cập nhật mà web quan sát, gồm tải lên, quét, cách ly và thao
            tác tệp. Thông báo và trạng thái đã đọc được giữ khi mở lại trang, đồng bộ máy chủ khi
            dịch vụ hỗ trợ. Khi mất mạng, dữ liệu tạm lưu trên trình duyệt; tối đa 2.000 thông báo
            gần nhất được lưu tại đây. Bảng này không thay thế audit log trên máy chủ.
          </p>
        </details>
        <details>
          <summary>Có phím tắt và dark mode không?</summary>
          <p>
            Gõ trực tiếp vào ô tìm kiếm trên header để lọc tên tệp; Ctrl+K hoặc Cmd+K để chọn ô này.
            Tab để di chuyển giữa các nút, Escape để đóng bảng chi tiết hoặc hộp thoại. Đổi Sáng /
            Tối / Theo hệ thống ở biểu tượng giao diện góc trên hoặc trong Cài đặt.
          </p>
        </details>
      </section>
    </>
  );
}

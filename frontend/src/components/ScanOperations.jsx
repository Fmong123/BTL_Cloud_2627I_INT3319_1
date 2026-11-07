import { useState } from 'react';
import { Link } from 'react-router-dom';
import { scanExplanation, scanStates } from '../utils/processing.js';
import { runAdminScanOperation } from '../api/client.js';
import ScanBadge from './ScanBadge.jsx';

const sizeGuidance = {
  file_too_large: 'Yêu cầu nén tệp',
  image_too_large: 'Nhờ chủ tệp giảm dung lượng ảnh rồi tải lại.',
};
const operationLabels = {
  check: 'Kiểm tra trạng thái',
  retry: 'Thử quét lại',
  request_compression: 'Yêu cầu nén tệp',
  withdraw_compression: 'Thu hồi yêu cầu',
};

const methods = {
  direct_text: 'Đọc văn bản trực tiếp',
  pdf_text: 'PDF có lớp chữ',
  textract_pdf: 'OCR PDF',
  textract_image: 'OCR ảnh',
};

export default function ScanOperations({ baseUrl, counts, durations, operations, onChange }) {
  const [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(25);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  async function run(item, action) {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await runAdminScanOperation(baseUrl, item, action);
      setFeedback({ message: result.message });
    } catch (error) {
      setFeedback({ message: error.message, error: true });
    } finally {
      setBusy(false);
      onChange();
    }
  }
  const visible = operations.filter((item) => {
    if (filter === 'review') return item.review_pending;
    if (filter === 'slow') return item.status === 'scanning' && item.age_seconds >= 300;
    if (filter === 'errors')
      return (
        item.pipeline_attention ||
        ['error', 'unscanned', 'quarantine_delete_failed'].includes(item.status)
      );
    return true;
  });
  return (
    <>
      <section className="files-section security-guide">
        <div className="files-heading">
          <div>
            <h2>Vận hành quét</h2>
            <p>Lượt quét, bước cách ly, thông báo cần đối soát và yêu cầu xem xét.</p>
          </div>
          <select
            className="admin-filter-select"
            aria-label="Lọc lượt xử lý"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setLimit(25);
            }}
          >
            <option value="all">Tất cả mục cần theo dõi</option>
            <option value="slow">Chậm hơn dự kiến</option>
            <option value="errors">Lỗi hoặc chưa thể quét</option>
            <option value="review">Yêu cầu xem xét cách ly</option>
          </select>
        </div>
        {feedback && (
          <p className="admin-feedback" role={feedback.error ? 'alert' : 'status'}>
            {feedback.message}
          </p>
        )}
        {visible.length ? (
          <ul className="operation-list">
            {visible.slice(0, limit).map((item) => {
              const guidance =
                item.status === 'unscanned' && Object.hasOwn(sizeGuidance, item.reason)
                  ? sizeGuidance[item.reason]
                  : null;
              const detailLink = {
                pathname: '/admin/quarantine',
                search: new URLSearchParams({ owner: item.owner_id, file: item.id }).toString(),
              };
              return (
                <li key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    <p>
                      {item.owner_name}
                      {item.review_pending ? ' · Chờ xem xét' : ''}
                    </p>
                    <ScanBadge
                      scanStatus={item.status}
                      statusReason={item.reason}
                      scanStartedAt={Date.parse(item.scan_started_at)}
                      trackingExpired={item.status === 'scanning' && item.age_seconds >= 300}
                    />
                    {item.reason && (
                      <p>
                        {scanExplanation({ scanStatus: item.status, statusReason: item.reason })}
                      </p>
                    )}
                    {item.compression_requested ? (
                      <p>
                        {item.compression_resolution === 'completed'
                          ? 'Chủ tệp đã đánh dấu xử lý'
                          : item.compression_resolution === 'withdrawn'
                            ? 'Đã thu hồi yêu cầu nén tệp'
                            : 'Đã gửi yêu cầu nén tệp'}
                      </p>
                    ) : (
                      guidance &&
                      !item.actions?.includes('request_compression') && <p>{guidance}</p>
                    )}
                    {item.age_seconds != null && (
                      <p>Đã qua {Math.floor(item.age_seconds / 60)} phút</p>
                    )}
                    {item.pipeline_attention && (
                      <p>
                        {item.pipeline_busy
                          ? 'Đang xử lý lại bước pipeline · cần kiểm tra kết quả'
                          : 'Có bước cách ly hoặc thông báo cần xử lý'}
                      </p>
                    )}
                  </div>
                  <div className="inline-actions">
                    <Link className="button secondary" to={detailLink}>
                      Xem chi tiết
                    </Link>
                    {item.actions?.map((action) => (
                      <button
                        className="button secondary"
                        key={action}
                        disabled={busy}
                        onClick={() => run(item, action)}
                      >
                        {operationLabels[action]}
                      </button>
                    ))}
                    {item.review_pending && (
                      <Link
                        className="button secondary"
                        to={detailLink}
                        state={{ focusReview: true }}
                      >
                        Xử lý yêu cầu
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="empty-state">
            <p>Không có tệp phù hợp.</p>
          </div>
        )}
        {visible.length > limit && (
          <div className="admin-pagination">
            <span role="status">
              Đang hiển thị {limit} / {visible.length} tệp
            </span>
            <button className="button secondary" onClick={() => setLimit(limit + 25)}>
              Xem thêm
            </button>
          </div>
        )}
      </section>
      <section className="files-section security-guide">
        <div className="files-heading">
          <div>
            <h2>Báo cáo vận hành</h2>
            <p>
              Tổng hợp theo kết quả mới nhất của tệp đang hoạt động. Thời gian bên dưới chỉ tính
              bước trích xuất.
            </p>
          </div>
          <Link className="button secondary" to="/admin/reports">
            Mở thống kê
          </Link>
        </div>
        <ul className="operation-list">
          <li>
            <span>Quét lỗi</span>
            <strong>{counts.error ?? 0}</strong>
          </li>
          <li>
            <span>Chưa thể quét</span>
            <strong>{counts.unscanned ?? 0}</strong>
          </li>
          <li>
            <span>Đã khôi phục</span>
            <strong>{counts.restored ?? 0}</strong>
          </li>
          {Object.entries(durations).map(([method, data]) => (
            <li key={method}>
              <span>
                {methods[method]} · {data.count} tệp
              </span>
              <strong>
                {(data.total_ms / data.count / 1000).toLocaleString('vi-VN', {
                  maximumFractionDigits: 2,
                })}{' '}
                giây trung bình
              </strong>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

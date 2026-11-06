import { useEffect, useState } from 'react';
import { Clock3, RefreshCw } from 'lucide-react';
import { getFileHistory } from '../api/client.js';
const labels = {
  upload_started: 'Bắt đầu tải lên',
  upload_completed: 'Tải lên hoàn tất',
  upload_failed: 'Tải lên thất bại',
  scan_started: 'Bắt đầu quét',
  scan_completed: 'Quét hoàn tất',
  rescan_requested: 'Yêu cầu quét lại',
  quarantined: 'Đã cách ly',
  file_trashed: 'Chuyển vào thùng rác',
  file_restored: 'Khôi phục tệp',
  file_renamed: 'Đổi tên tệp',
  scan_safe: 'Quét an toàn',
  scan_flagged: 'Phát hiện dữ liệu nhạy cảm',
  scan_error: 'Quét gặp lỗi',
  scan_unscanned: 'Không áp dụng quét',
  quarantine_completed: 'Cách ly hoàn tất',
  quarantine_failed: 'Cách ly gặp lỗi',
  quarantine_delete_failed: 'Chưa xóa được nguồn sau cách ly',
  notify_safe: 'Đã gửi thông báo an toàn',
  notify_quarantined: 'Đã gửi thông báo cách ly',
  notify_failed: 'Gửi thông báo gặp lỗi',
  notify_safe_sns: 'Đã gửi thông báo an toàn qua SNS',
  notify_quarantined_sns: 'Đã gửi thông báo cách ly qua SNS',
  notify_safe_webhook: 'Đã gửi thông báo an toàn qua kênh tích hợp',
  notify_quarantined_webhook: 'Đã gửi thông báo cách ly qua kênh tích hợp',
  admin_quarantine_read_started: 'Quản trị viên bắt đầu đọc bản cách ly',
  admin_quarantine_read_completed: 'Quản trị viên đã đọc bản cách ly',
  admin_quarantine_read_failed: 'Quản trị viên đọc bản cách ly chưa thành công',
  quarantine_review_requested: 'Đã gửi yêu cầu xem xét cách ly',
  quarantine_review_decided: 'Quản trị viên đã quyết định về yêu cầu xem xét',
  admin_scan_compression_requested: 'Quản trị viên đã yêu cầu nén lại tệp',
  admin_scan_compression_withdrawn: 'Quản trị viên đã thu hồi yêu cầu nén tệp',
  compression_request_completed: 'Chủ tệp đã đánh dấu xử lý yêu cầu nén',
  admin_scan_status_reconciled: 'Quản trị viên đã đối chiếu trạng thái lượt quét',
};

export default function FileHistory({ file, ownerId, refreshKey }) {
  const [state, setState] = useState({ items: [], cursor: null, loading: true, error: '' });
  const [revision, refresh] = useState(0);
  const [page, setPage] = useState(null);
  useEffect(() => {
    if (!file.remoteId || file.mode === 'demo' || file.lifecycleState === 'purged') {
      setState({ items: [], cursor: null, loading: false, error: '' });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: '' }));
    getFileHistory(file.connection.baseUrl, file.remoteId, {
      cursor: page,
      ownerId,
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted)
          setState((s) => ({
            items: page ? [...s.items, ...result.items] : result.items,
            cursor: result.next_cursor,
            loading: false,
            error: '',
          }));
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setState((s) => ({ ...s, loading: false, error: e.message }));
      });
    return () => controller.abort();
  }, [file.remoteId, file.connection?.baseUrl, ownerId, page, revision, refreshKey]);
  return (
    <section className="file-history" aria-label="Lịch sử tệp">
      <div className="file-history-heading">
        <h3>
          <Clock3 size={16} /> Lịch sử tệp
        </h3>
        <button
          className="icon-button"
          aria-label="Cập nhật lịch sử tệp"
          disabled={state.loading}
          onClick={() => {
            setPage(null);
            refresh((x) => x + 1);
          }}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      {state.error && (
        <p role="alert" className="banner warning">
          {state.error}
        </p>
      )}
      {!state.loading && !state.error && !state.items.length && (
        <p className="muted">Chưa có lịch sử từ máy chủ.</p>
      )}
      <ol className="processing-timeline">
        {state.items.map((item) => (
          <li key={item.event_key}>
            <span className="timeline-marker">
              <Clock3 size={15} />
            </span>
            <div>
              <strong>{labels[item.action] || item.action}</strong>
              <p>{new Date(item.occurred_at).toLocaleString('vi-VN')}</p>
              {ownerId && (
                <p className="muted">
                  Thực hiện bởi: {item.actor_name || item.actor || 'Hệ thống'}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
      {state.loading && <p role="status">Đang đọc lịch sử…</p>}
      {state.cursor && (
        <button
          className="button secondary"
          disabled={state.loading}
          onClick={() => setPage(state.cursor)}
        >
          Xem thêm
        </button>
      )}
    </section>
  );
}

import { RefreshCw, CircleAlert, CheckCircle2, Clock3 } from 'lucide-react';

const labels = {
  waiting: 'Chờ lượt đối chiếu đầu tiên',
  running: 'Đang đối chiếu',
  ok: 'Đã cập nhật',
  degraded: 'Có mục cần thử lại',
  error: 'Đối chiếu gặp lỗi',
  delayed: 'Đối chiếu bị chậm',
  unavailable: 'Chưa sẵn sàng',
};
const at = (value) =>
  value
    ? new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
    : 'Chưa ghi nhận';

export default function BillingReconciliation({ status = {}, busy, onReconcile }) {
  const problem = ['degraded', 'error', 'delayed', 'unavailable'].includes(status.state);
  const Icon = problem ? CircleAlert : status.state === 'ok' ? CheckCircle2 : Clock3;
  return (
    <section className="settings-section billing-reconciliation" aria-label="Đối chiếu tự động">
      <div className="billing-statistics-heading">
        <div>
          <h2>Đối chiếu tự động</h2>
          <p className="billing-muted">Kiểm tra khoảng mỗi 60 giây khi máy chủ hoạt động.</p>
        </div>
        <button
          className="button secondary"
          onClick={onReconcile}
          disabled={busy || status.state === 'running'}
        >
          <RefreshCw size={16} aria-hidden="true" />
          {busy ? 'Đang đối chiếu…' : 'Đối chiếu ngay'}
        </button>
      </div>
      <p
        className={`billing-reconciliation-state ${problem ? 'warning' : status.state === 'ok' ? 'success' : ''}`}
        role={problem ? 'alert' : 'status'}
      >
        <Icon size={17} aria-hidden="true" />
        {labels[status.state] || labels.waiting}
      </p>
      <dl className="billing-reconciliation-times">
        <div>
          <dt>Lần thử gần nhất</dt>
          <dd>{at(status.last_started_at)}</dd>
        </div>
        <div>
          <dt>Thành công gần nhất</dt>
          <dd>{at(status.last_success_at)}</dd>
        </div>
        {Number.isInteger(status.repairs) && (
          <div>
            <dt>Bản ghi bổ sung trong lượt gần nhất</dt>
            <dd>{status.repairs}</dd>
          </div>
        )}
      </dl>
      {problem && (
        <p className="billing-muted">
          Một số thông báo hoặc thống kê có thể cập nhật chậm. Hệ thống sẽ thử lại; bạn có thể chọn
          Đối chiếu ngay để kiểm tra.
        </p>
      )}
    </section>
  );
}

import { RotateCcw, X } from 'lucide-react';
import { useWorkspace } from '../state/Workspace.jsx';
import { canRetry, isBusy } from '../utils/workspace.js';
import { needsTracking } from '../utils/processing.js';
import FileBrowser from '../components/FileBrowser.jsx';

export default function Uploads() {
  const w = useWorkspace();
  const activity = w.activityFiles || w.files;
  const active = activity.filter(isBusy);
  const retryable = activity.filter(canRetry);
  const done = activity.filter((file) => file.status === 'success').length;
  const failed = activity.filter((file) => file.status === 'error').length;
  const tracking = w.files.filter(needsTracking).length;
  const stats = [
    ['Đang tải / chờ', active.length],
    ['Đã tải xong', done],
    ['Lỗi tải lên', failed],
    ['Chờ kết quả', tracking],
  ];
  return (
    <>
      <section className="activity-summary" aria-label="Tổng hợp xử lý">
        <div className="activity-summary-heading">
          <div>
            <h2>Theo dõi từ tải lên đến xử lý</h2>
            <p>Tối đa 5 tệp tải song song, cập nhật kết quả xử lý tự động.</p>
          </div>
          <div className="inline-actions">
            <button
              className="button secondary"
              disabled={!retryable.length}
              onClick={() => w.retry(retryable.map((file) => file.id))}
            >
              <RotateCcw size={16} />
              Thử lại tệp lỗi / đã hủy
            </button>
            <button
              className="button secondary"
              disabled={!active.length}
              onClick={() => w.cancel(active.map((file) => file.id))}
            >
              <X size={16} />
              Hủy tất cả
            </button>
          </div>
        </div>
        <dl className="activity-stats">
          {stats.map(([label, count]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{count}</dd>
            </div>
          ))}
        </dl>
        <p className="activity-cancel-note">
          Hủy ở trình duyệt không đảm bảo máy chủ chưa lưu tệp.
        </p>
      </section>
      <p className="activity-steps">
        <span>Tải lên</span>→<span>Quét dữ liệu</span>→<span>Cách ly nếu cần</span>
      </p>
      <FileBrowser activity />
      {w.uploadBatches?.length > 0 && (
        <section className="upload-batches" aria-label="Các đợt tải lên">
          <h2>Các đợt tải lên</h2>
          <p>Mỗi lần chọn hoặc thả tệp là một đợt trong phiên hiện tại.</p>
          <div className="batch-list">
            {w.uploadBatches.map((batch, index) => (
              <article className="batch-row" key={batch.id}>
                <div>
                  <h3>
                    Đợt tải {w.uploadBatches.length - index} · {batch.total} tệp
                  </h3>
                  <time dateTime={new Date(batch.createdAt).toISOString()}>
                    <span className="batch-date">
                      {new Date(batch.createdAt).toLocaleDateString('vi-VN')}
                    </span>
                    <span className="batch-clock">
                      {new Date(batch.createdAt).toLocaleTimeString('vi-VN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </time>
                </div>
                <p>
                  {batch.uploaded} đã tải xong · {batch.active} đang tải / chờ · {batch.failed} lỗi
                  · {batch.tracking} chờ kết quả
                  {batch.cancelled > 0 ? ` · ${batch.cancelled} đã hủy` : ''}
                  {batch.uncertain > 0 ? ` · ${batch.uncertain} chưa rõ kết quả` : ''}
                </p>
                <button
                  className="button secondary"
                  disabled={!batch.retryableIds?.length}
                  onClick={() => w.retryBatch(batch.id)}
                >
                  <RotateCcw size={15} />
                  Thử lại {batch.retryableIds?.length || 0} tệp trong đợt
                </button>
              </article>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

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
  return (
    <>
      <div className="activity-summary">
        <div>
          <h2>Theo dõi từ tải lên đến xử lý</h2>
          <p>
            {active.length} đang tải / chờ · {done} đã tải xong · {failed} lỗi upload · {tracking}{' '}
            chờ kết quả
          </p>
          <small>
            Tối đa 5 tệp tải song song. Hủy ở trình duyệt không đảm bảo máy chủ chưa lưu tệp.
          </small>
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
      <p className="activity-steps">
        <span>Tải lên</span>→<span>Quét dữ liệu</span>→<span>Cách ly nếu cần</span>
      </p>
      <FileBrowser activity />
    </>
  );
}

import { RotateCcw, X } from 'lucide-react';
import { useWorkspace } from '../state/Workspace.jsx';
import { canRetry, isBusy } from '../utils/workspace.js';
import FileBrowser from '../components/FileBrowser.jsx';

export default function Uploads() {
  const w = useWorkspace();
  const active = w.files.filter(isBusy);
  const retryable = w.files.filter(canRetry);
  const done = w.files.filter((file) => file.status === 'success').length;
  const failed = w.files.filter((file) => file.status === 'error').length;
  return (
    <>
      <div className="activity-summary">
        <div>
          <h2>Theo dõi từng lượt tải</h2>
          <p>
            {active.length} đang tải / chờ · {done} hoàn tất · {failed} lỗi
          </p>
          <small>
            Tệp được tải lần lượt. Hủy ở trình duyệt không đảm bảo máy chủ chưa lưu tệp.
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
      <FileBrowser activity />
    </>
  );
}

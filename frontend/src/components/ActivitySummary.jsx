import { RotateCcw, X } from 'lucide-react';
import { activityGroups, activitySummary } from '../utils/activity.js';
import { canRetry, isBusy } from '../utils/workspace.js';

export default function ActivitySummary({ files, period, group, onGroup, workspace: w }) {
  const counts = activitySummary(files);
  const retryable = files.filter(canRetry);
  const uploading = files.filter(isBusy);
  return (
    <section className="activity-summary" aria-label="Tổng hợp xử lý">
      <div className="activity-summary-heading">
        <div>
          <h2>Theo dõi xử lý tệp</h2>
          <p>{period} · Tệp đang xử lý được ưu tiên hiển thị.</p>
        </div>
        <div className="inline-actions">
          {retryable.length > 0 && (
            <button
              className="button secondary"
              onClick={() => w.retry(retryable.map((f) => f.id))}
            >
              <RotateCcw size={16} />
              Thử tải lại {retryable.length} tệp
            </button>
          )}
          {uploading.length > 0 && (
            <button
              className="button secondary"
              onClick={() => w.cancel(uploading.map((f) => f.id))}
            >
              <X size={16} />
              Hủy tất cả
            </button>
          )}
        </div>
      </div>
      <div className="activity-stats activity-stat-filters" role="group" aria-label="Lọc hoạt động">
        {Object.entries(counts).map(([key, count]) => (
          <button
            key={key}
            aria-pressed={group === key}
            onClick={() => onGroup(group === key ? 'all' : key)}
          >
            <span>{activityGroups[key]}</span>
            <strong>{count}</strong>
          </button>
        ))}
      </div>
      {uploading.length > 0 && (
        <p className="activity-cancel-note">
          Hủy ở trình duyệt không đảm bảo máy chủ chưa lưu tệp.
        </p>
      )}
    </section>
  );
}

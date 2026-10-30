import { Cloud } from 'lucide-react';
import { useWorkspace } from '../state/Workspace.jsx';
import { FREE_STORAGE_BYTES, formatStorageUsage, storedBytes } from '../utils/storageUsage.js';

export default function SidebarStorage({ collapsed }) {
  const w = useWorkspace();
  const used = storedBytes(w.files);
  const demo = w.preferences.mode === 'demo';
  const phase = w.sync?.phase || 'idle';
  const known =
    demo || used > 0 || Boolean(w.sync?.lastSyncedAt) || ['ready', 'disabled'].includes(phase);
  const partial =
    !demo &&
    (phase !== 'ready' ||
      Boolean(w.sync?.skippedItems?.length) ||
      w.files.some((file) => file.uploadState === 'unknown'));
  const usage = formatStorageUsage(used);
  const pending = phase === 'error' ? 'Chưa đọc được dung lượng' : 'Đang tính dung lượng';
  const summary = known
    ? `Đã sử dụng ${usage} trong tổng số 1 GB`
    : `${pending} trong tổng số 1 GB`;
  const note = demo
    ? 'Dữ liệu trải nghiệm'
    : partial
      ? phase === 'error'
        ? 'Chưa đồng bộ đầy đủ'
        : 'Dung lượng tạm tính'
      : used >= FREE_STORAGE_BYTES
        ? 'Đã dùng hết dung lượng miễn phí'
        : 'Gói miễn phí';
  return (
    <section
      className={`sidebar-storage ${used >= FREE_STORAGE_BYTES * 0.9 ? 'storage-near-limit' : ''}`}
      aria-label={`Bộ nhớ · ${summary}`}
      title={collapsed ? `${summary} · ${note}` : undefined}
    >
      <div className="sidebar-storage-heading">
        <Cloud size={20} aria-hidden="true" />
        <span>Bộ nhớ</span>
      </div>
      <div className="sidebar-storage-details">
        <progress
          aria-label="Dung lượng đã sử dụng"
          aria-valuetext={known ? `${usage} / 1 GB${partial ? ' · tạm tính' : ''}` : 'Đang tính'}
          max={FREE_STORAGE_BYTES}
          value={known ? Math.min(used, FREE_STORAGE_BYTES) : undefined}
        />
        <p aria-live="polite">
          {known ? (
            <>
              Đã sử dụng <strong>{usage}</strong> trong tổng số <strong>1 GB</strong>
            </>
          ) : (
            <>
              {pending} trong tổng số <strong>1 GB</strong>
            </>
          )}
        </p>
        <span className="storage-plan-note">{note}</span>
      </div>
    </section>
  );
}

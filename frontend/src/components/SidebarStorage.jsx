import { Cloud } from 'lucide-react';
import { useWorkspace } from '../state/Workspace.jsx';
import { FREE_STORAGE_BYTES, formatStorageUsage, storedBytes } from '../utils/storageUsage.js';

export default function SidebarStorage({ collapsed }) {
  const w = useWorkspace();
  const serverQuota = w.storageQuota;
  const authoritative = w.quotaAvailable && Number.isSafeInteger(serverQuota?.used);
  const used = authoritative
    ? serverQuota.used
    : storedBytes((w.allFiles || w.files).filter((file) => file.lifecycleState !== 'purged'));
  const demo = w.preferences.mode === 'demo';
  const phase = w.sync?.phase || 'idle';
  const known =
    authoritative ||
    (!w.quotaAvailable &&
      (demo || used > 0 || Boolean(w.sync?.lastSyncedAt) || ['ready', 'disabled'].includes(phase)));
  const partial =
    !authoritative &&
    !demo &&
    (phase !== 'ready' ||
      Boolean(w.sync?.skippedItems?.length) ||
      w.files.some((file) => file.uploadState === 'unknown'));
  const usage = formatStorageUsage(used);
  const limit = authoritative ? serverQuota.limit : FREE_STORAGE_BYTES;
  const limitLabel = formatStorageUsage(limit);
  const pending = phase === 'error' ? 'Chưa đọc được dung lượng' : 'Đang tính dung lượng';
  const summary = known
    ? `Đã sử dụng ${usage} trong tổng số ${limitLabel}`
    : `${pending} trong tổng số ${limitLabel}`;
  const note = demo
    ? 'Dữ liệu trải nghiệm'
    : serverQuota?.error
      ? 'Chưa cập nhật được dung lượng'
      : serverQuota?.reserved > 0
        ? `Đang giữ chỗ ${formatStorageUsage(serverQuota.reserved)} cho upload`
        : partial
          ? phase === 'error'
            ? 'Chưa đồng bộ đầy đủ'
            : 'Dung lượng tạm tính'
          : used >= limit
            ? 'Đã dùng hết dung lượng'
            : 'Hạn mức tài khoản';
  return (
    <section
      className={`sidebar-storage ${used >= limit * 0.9 ? 'storage-near-limit' : ''}`}
      aria-label={`Bộ nhớ cá nhân · ${summary}`}
      title={collapsed ? `${summary} · ${note}` : undefined}
    >
      <div className="sidebar-storage-heading">
        <Cloud size={20} aria-hidden="true" />
        <span>Bộ nhớ cá nhân</span>
      </div>
      <div className="sidebar-storage-details">
        <progress
          aria-label="Dung lượng đã sử dụng"
          aria-valuetext={
            known ? `${usage} / ${limitLabel}${partial ? ' · tạm tính' : ''}` : 'Đang tính'
          }
          max={Math.max(1, limit)}
          value={known ? Math.min(used, Math.max(1, limit)) : undefined}
        />
        <p aria-live="polite">
          {known ? (
            <>
              Đã sử dụng <strong>{usage}</strong> trong tổng số <strong>{limitLabel}</strong>
            </>
          ) : (
            <>
              {pending} trong tổng số <strong>{limitLabel}</strong>
            </>
          )}
        </p>
        <span className="storage-plan-note">{note}</span>
      </div>
    </section>
  );
}

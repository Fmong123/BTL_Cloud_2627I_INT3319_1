import { Check, CircleAlert, Clock3, LoaderCircle, ShieldAlert, ShieldCheck } from 'lucide-react';
import { scanExplanation, scanStates } from '../utils/processing.js';

export default function ScanBadge({
  scanStatus,
  mode,
  trackingExpired,
  statusReason,
  onInspect,
  scanStartedAt,
  createdAt,
  rescanRequestedAt,
}) {
  const since = [scanStartedAt, rescanRequestedAt, createdAt].find(Number.isFinite);
  const started = Number.isFinite(scanStartedAt);
  const delayed = trackingExpired || (Number.isFinite(since) && Date.now() - since >= 5 * 60_000);
  const state =
    mode === 'demo'
      ? { label: 'Không quét · trải nghiệm', tone: 'muted' }
      : scanStatus === 'scanning' && delayed
        ? { label: 'Chậm hơn dự kiến', tone: 'warning' }
        : scanStatus === 'scanning' && !started
          ? { label: 'Chờ xác nhận quét', tone: 'muted' }
          : scanStates[scanStatus] || { label: 'Chưa có kết quả', tone: 'muted' };
  const Icon =
    mode === 'demo'
      ? Clock3
      : {
          safe: Check,
          restored: Check,
          scanning: LoaderCircle,
          flagged: ShieldAlert,
          quarantined: ShieldCheck,
          quarantine_delete_failed: ShieldAlert,
          unscanned: CircleAlert,
          error: CircleAlert,
        }[scanStatus] || Clock3;
  const Tag = onInspect ? 'button' : 'span';
  return (
    <Tag
      type={onInspect ? 'button' : undefined}
      onClick={onInspect}
      aria-label={onInspect ? `${state.label} — xem lý do` : undefined}
      className={`status-badge scan-badge ${state.tone || 'muted'}`}
      title={
        scanStatus === 'scanning' && delayed
          ? 'Chưa nhận kết quả mới — có thể kiểm tra lại trong chi tiết tệp'
          : mode === 'demo'
            ? state.label
            : scanExplanation({ scanStatus, statusReason })
      }
    >
      <Icon size={13} className={scanStatus === 'scanning' && started && !delayed ? 'spin' : ''} />
      <span className="scan-label">{state.label}</span>
    </Tag>
  );
}

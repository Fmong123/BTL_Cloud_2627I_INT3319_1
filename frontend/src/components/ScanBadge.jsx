import { Check, CircleAlert, Clock3, LoaderCircle, ShieldAlert, ShieldCheck } from 'lucide-react';
import { scanExplanation, scanStates } from '../utils/processing.js';

export default function ScanBadge({ scanStatus, mode, trackingExpired, statusReason, onInspect }) {
  const state =
    mode === 'demo'
      ? { label: 'Không quét · trải nghiệm', tone: 'muted' }
      : scanStates[scanStatus] || { label: 'Chưa có kết quả', tone: 'muted' };
  const Icon =
    mode === 'demo'
      ? Clock3
      : {
          safe: Check,
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
        trackingExpired
          ? 'Chưa nhận kết quả mới — có thể kiểm tra lại trong chi tiết tệp'
          : mode === 'demo'
            ? state.label
            : scanExplanation({ scanStatus, statusReason })
      }
    >
      <Icon size={13} className={scanStatus === 'scanning' && !trackingExpired ? 'spin' : ''} />
      <span className="scan-label">{state.label}</span>
    </Tag>
  );
}

import { Check, CircleAlert, Clock3, LoaderCircle, ShieldAlert, ShieldCheck } from 'lucide-react';
import { scanStates } from '../utils/processing.js';

export default function ScanBadge({ scanStatus, mode, trackingExpired }) {
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
  return (
    <span
      className={`status-badge scan-badge ${state.tone || 'muted'}`}
      title={
        trackingExpired
          ? 'Chưa nhận kết quả mới — có thể kiểm tra lại trong chi tiết tệp'
          : undefined
      }
    >
      <Icon size={13} className={scanStatus === 'scanning' && !trackingExpired ? 'spin' : ''} />
      {state.label}
    </span>
  );
}

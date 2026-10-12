import { Check, CircleAlert, LoaderCircle, Pause, X } from 'lucide-react';

export default function StatusBadge({ status, mode, progress, storage }) {
  const states = {
    queued: { icon: Pause, text: 'Đang chờ', className: 'muted' },
    uploading: { icon: LoaderCircle, text: progress >= 99 ? 'Đang xử lý' : `Đang tải ${progress}%`, className: 'uploading' },
    success: { icon: Check, text: mode === 'demo' ? 'Bản trải nghiệm' : storage === 'local' ? 'Đã lưu local' : storage === 's3' ? 'Đã lưu S3' : 'API đã xác nhận', className: mode === 'demo' || storage === 'local' ? 'demo' : 'success' },
    error: { icon: CircleAlert, text: 'Chưa tải được', className: 'error' },
    cancelled: { icon: X, text: 'Đã hủy', className: 'muted' },
  };
  const state = states[status];
  const Icon = state.icon;
  return <span className={`status-badge ${state.className}`}><Icon size={13} className={status === 'uploading' ? 'spin' : ''} />{state.text}</span>;
}

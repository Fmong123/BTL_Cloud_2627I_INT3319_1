import { Check, CircleAlert, Clock3, LoaderCircle, Pause, X } from 'lucide-react';

export default function StatusBadge({
  status,
  mode,
  progress = 0,
  storage,
  uploadState,
  reconciling,
}) {
  const state =
    reconciling || status === 'unknown' || uploadState === 'unknown'
      ? { icon: Clock3, text: 'Chưa xác nhận lưu', className: 'warning' }
      : {
          queued: { icon: Pause, text: 'Đang chờ', className: 'muted' },
          uploading: {
            icon: LoaderCircle,
            text: progress >= 99 ? 'Chờ máy chủ xác nhận' : `Đang gửi ${progress}%`,
            className: 'uploading',
          },
          processing: { icon: LoaderCircle, text: 'Máy chủ đang lưu', className: 'uploading' },
          success: {
            icon: Check,
            text:
              mode === 'demo'
                ? 'Bản trải nghiệm'
                : storage === 'local'
                  ? 'Đã lưu local'
                  : storage === 's3'
                    ? 'Đã lưu S3'
                    : 'API đã xác nhận',
            className: mode === 'demo' || storage === 'local' ? 'demo' : 'success',
          },
          error: { icon: CircleAlert, text: 'Chưa tải được', className: 'error' },
          cancelled: { icon: X, text: 'Đã hủy', className: 'muted' },
        }[status] || { icon: Clock3, text: 'Chưa xác định', className: 'muted' };
  const Icon = state.icon;
  return (
    <span className={`status-badge ${state.className}`}>
      <Icon size={13} className={['uploading', 'processing'].includes(status) ? 'spin' : ''} />
      {state.text}
    </span>
  );
}

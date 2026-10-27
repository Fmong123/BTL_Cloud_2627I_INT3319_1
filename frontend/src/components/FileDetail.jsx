import { useEffect, useRef, useState } from 'react';
import {
  Check,
  CircleAlert,
  Clock3,
  Copy,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useWorkspace } from '../state/Workspace.jsx';
import { formatBytes } from '../utils/files.js';
import FileIcon from './FileIcon.jsx';
import StatusBadge from './StatusBadge.jsx';
import ScanBadge from './ScanBadge.jsx';
import '../file-workspace.css';

const reasons = {
  unsupported_type: 'Định dạng chưa được hỗ trợ quét',
  file_too_large: 'Tệp vượt giới hạn quét',
  quarantine_delete_failed: 'Chưa xóa được bản nguồn sau khi sao chép cách ly',
  storage_unconfirmed: 'Máy chủ chưa xác nhận được việc lưu nội dung',
  storage_unavailable: 'Dịch vụ lưu trữ chưa sẵn sàng',
  initial_audit_unconfirmed: 'Chưa xác nhận được bản ghi hoạt động tải lên',
};
const time = (value) =>
  value && Number.isFinite(new Date(value).getTime())
    ? new Date(value).toLocaleString('vi-VN')
    : 'Chưa có';

export default function FileDetail({ id, onClose }) {
  const w = useWorkspace();
  const inspectedId = id ?? w.inspectedId;
  const file =
    w.files.find((item) => item.id === inspectedId || item.remoteId === inspectedId) ||
    (w.activityFiles || []).find(
      (item) => item.id === inspectedId || item.remoteId === inspectedId,
    );
  const [tab, setTab] = useState('information');
  const titleRef = useRef(null);
  const closeRef = useRef(null);
  const close = () => (onClose ? onClose() : w.inspect?.(null));
  closeRef.current = close;
  useEffect(() => {
    if (!inspectedId) return;
    const previous = document.activeElement;
    setTab('information');
    document.body.classList.add('has-file-detail');
    titleRef.current?.focus({ preventScroll: true });
    const escape = (event) => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        !document.querySelector('dialog[open]')
      ) {
        event.preventDefault();
        closeRef.current?.();
      }
    };
    document.addEventListener('keydown', escape);
    return () => {
      document.body.classList.remove('has-file-detail');
      document.removeEventListener('keydown', escape);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
      else document.querySelector('main h1')?.focus({ preventScroll: true });
    };
  }, [inspectedId]);
  if (!inspectedId) return null;
  if (!file)
    return (
      <aside className="file-detail-drawer" role="region" aria-label="Thông tin tệp">
        <div className="drawer-heading">
          <h2 tabIndex={-1} ref={titleRef}>
            Thông tin tệp
          </h2>
          <button className="icon-button" aria-label="Đóng thông tin tệp" onClick={close}>
            <X size={20} />
          </button>
        </div>
        <p className="drawer-empty">
          Không tìm thấy tệp trong kết nối hiện tại. Danh sách có thể đã thay đổi.
        </p>
      </aside>
    );
  async function copy(value) {
    try {
      await navigator.clipboard.writeText(String(value));
      w.notify('Đã sao chép');
    } catch {
      w.notify('Không thể sao chép tự động. Bạn có thể chọn và sao chép nội dung trong chi tiết.');
    }
  }
  const row = (label, value) => (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
  const copyRow = (label, value) =>
    row(
      label,
      <span className="copy-value">
        <span>{value}</span>
        <button
          className="icon-button"
          aria-label={`Sao chép ${label.toLowerCase()}`}
          onClick={() => copy(value)}
        >
          <Copy size={16} />
        </button>
      </span>,
    );
  const hasScanResult = ['safe', 'flagged', 'quarantined', 'quarantine_delete_failed'].includes(
    file.scanStatus,
  );
  const uploadConfirmed = file.status === 'success' || file.uploadState === 'uploaded';
  const isolated = file.scanStatus === 'quarantined';
  const quarantineProblem = file.scanStatus === 'quarantine_delete_failed';
  const detected = ['flagged', 'quarantined', 'quarantine_delete_failed'].includes(file.scanStatus);
  const scanStep =
    file.mode === 'demo'
      ? { label: 'Không áp dụng · trải nghiệm', tone: 'muted', state: 'pending', icon: Clock3 }
      : detected
        ? {
            label: 'Phát hiện dữ liệu nhạy cảm',
            tone: 'warning',
            state: 'issue',
            icon: ShieldAlert,
          }
        : {
            safe: {
              label: 'An toàn',
              tone: 'success',
              state: 'complete',
              icon: Check,
            },
            scanning: {
              label: 'Đang chờ / đang quét',
              tone: 'uploading',
              state: 'pending',
              icon: Clock3,
            },
            not_started: {
              label: 'Chưa bắt đầu quét',
              tone: 'muted',
              state: 'pending',
              icon: Clock3,
            },
            error: { label: 'Lỗi xử lý quét', tone: 'error', state: 'issue', icon: CircleAlert },
            unscanned: {
              label: 'Không quét được',
              tone: 'warning',
              state: 'issue',
              icon: CircleAlert,
            },
          }[file.scanStatus] || {
            label: 'Chưa có kết quả quét',
            tone: 'muted',
            state: 'pending',
            icon: Clock3,
          };
  const ScanStepIcon = scanStep.icon;
  return (
    <aside className="file-detail-drawer" role="region" aria-label="Thông tin tệp">
      <div className="drawer-heading">
        <h2 tabIndex={-1} ref={titleRef}>
          Thông tin tệp
        </h2>
        <button
          className="icon-button"
          aria-label="Đóng thông tin tệp"
          title="Đóng (Escape)"
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      <div className="drawer-file-title">
        <FileIcon file={file} large />
        <div>
          <h3>{file.name}</h3>
          <p>
            {formatBytes(file.size)} · {file.type || 'Không xác định định dạng'}
          </p>
        </div>
      </div>
      <div
        className="drawer-tabs"
        role="tablist"
        aria-label="Chi tiết tệp"
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next =
            event.key === 'Home'
              ? 'information'
              : event.key === 'End'
                ? 'processing'
                : tab === 'information'
                  ? 'processing'
                  : 'information';
          setTab(next);
          document
            .getElementById(next === 'information' ? 'detail-info-tab' : 'detail-processing-tab')
            ?.focus();
        }}
      >
        <button
          id="detail-info-tab"
          role="tab"
          aria-selected={tab === 'information'}
          tabIndex={tab === 'information' ? 0 : -1}
          aria-controls="detail-info"
          onClick={() => setTab('information')}
        >
          Thông tin
        </button>
        <button
          id="detail-processing-tab"
          role="tab"
          aria-selected={tab === 'processing'}
          tabIndex={tab === 'processing' ? 0 : -1}
          aria-controls="detail-processing"
          onClick={() => setTab('processing')}
        >
          Xử lý
        </button>
      </div>
      <div className="drawer-content">
        {tab === 'information' ? (
          <section id="detail-info" role="tabpanel" aria-labelledby="detail-info-tab">
            <dl className="file-details">
              {copyRow('Tên tệp', file.name)}
              {row('Tải lên', <StatusBadge {...file} />)}
              {row('Quét / cách ly', <ScanBadge {...file} />)}
              {row('Kích thước', formatBytes(file.size))}
              {row('Định dạng', file.type || 'Không xác định')}
              {row('Thời gian thêm', time(file.createdAt))}
              {row(
                'Nơi lưu trữ',
                file.mode === 'demo'
                  ? 'Trải nghiệm — chưa gửi nội dung đến máy chủ'
                  : file.storage === 'local'
                    ? 'Ổ đĩa máy chạy API'
                    : file.storage === 's3'
                      ? 'Amazon S3'
                      : 'Chưa được máy chủ xác nhận',
              )}
              {row('Cập nhật máy chủ', time(file.updatedAt))}
            </dl>
            <details className="technical-details">
              <summary>Thông tin kỹ thuật</summary>
              <dl className="file-details">
                {file.remoteId != null && copyRow('ID máy chủ', file.remoteId)}
                {file.key && copyRow('Object key', file.key)}
                {row(
                  'Nguồn dữ liệu',
                  file.origin === 'server'
                    ? 'Metadata do FastAPI đọc từ DynamoDB'
                    : 'Lượt tải trong phiên trình duyệt',
                )}
              </dl>
              <p>Object key là định danh, không phải liên kết tải xuống.</p>
            </details>
          </section>
        ) : (
          <section id="detail-processing" role="tabpanel" aria-labelledby="detail-processing-tab">
            <ol className="processing-timeline">
              <li className={uploadConfirmed ? 'complete' : 'pending'}>
                <span className="timeline-marker">
                  {uploadConfirmed ? <Check size={17} /> : <Clock3 size={17} />}
                </span>
                <div>
                  <h3>Tải lên</h3>
                  <StatusBadge {...file} />
                  <p>
                    {file.mode === 'demo'
                      ? 'Chỉ mô phỏng trong trình duyệt.'
                      : uploadConfirmed
                        ? 'Máy chủ đã xác nhận lưu nội dung. Kết quả quét là bước riêng.'
                        : 'Đang chờ xác nhận việc lưu nội dung.'}
                  </p>
                </div>
              </li>
              <li className={scanStep.state}>
                <span className="timeline-marker">
                  <ScanStepIcon size={17} />
                </span>
                <div>
                  <h3>Quét dữ liệu</h3>
                  <span className={`status-badge ${scanStep.tone}`}>
                    <ScanStepIcon size={13} />
                    {scanStep.label}
                  </span>
                  <p>
                    {file.mode === 'demo'
                      ? 'Không áp dụng với tệp trải nghiệm.'
                      : file.scannedAt
                        ? `Kết quả lúc ${time(file.scannedAt)}`
                        : 'Chưa có thời gian hoàn tất do máy chủ cung cấp.'}
                  </p>
                </div>
              </li>
              <li className={isolated ? 'complete' : quarantineProblem ? 'issue' : 'pending'}>
                <span className="timeline-marker">
                  {isolated ? (
                    <ShieldCheck size={17} />
                  ) : quarantineProblem ? (
                    <ShieldAlert size={17} />
                  ) : (
                    <Clock3 size={17} />
                  )}
                </span>
                <div>
                  <h3>Cách ly nếu cần</h3>
                  <p className="timeline-label">
                    {file.mode === 'demo' || file.scanStatus === 'safe'
                      ? 'Không áp dụng'
                      : isolated
                        ? 'Đã cách ly'
                        : quarantineProblem
                          ? 'Chưa hoàn tất — bản nguồn có thể vẫn còn'
                          : file.scanStatus === 'flagged'
                            ? 'Đang chờ hoặc đang thực hiện cách ly'
                            : 'Chưa có xác nhận cách ly'}
                  </p>
                  {file.quarantinedAt && <p>{time(file.quarantinedAt)}</p>}
                </div>
              </li>
            </ol>
            <dl className="file-details">
              {row(
                'Số phát hiện',
                hasScanResult ? (file.findingsCount ?? 'Chưa có') : 'Chưa có kết quả',
              )}
              {row(
                'Loại phát hiện',
                hasScanResult
                  ? file.findingTypes?.length
                    ? file.findingTypes.join(', ')
                    : 'Không ghi nhận'
                  : 'Chưa có kết quả',
              )}
              {file.statusReason && row('Lý do', reasons[file.statusReason] || file.statusReason)}
              {row('Cập nhật gần nhất', time(file.updatedAt))}
            </dl>
            <p className="info-box">
              Chỉ hiển thị tóm tắt do máy chủ cung cấp, không hiển thị nội dung dữ liệu nhạy cảm.
              Không phát hiện PII không đồng nghĩa đã kiểm tra mọi rủi ro của tệp.
            </p>
          </section>
        )}
        {file.error && (
          <p className="banner error" role="alert">
            {file.error}
          </p>
        )}
        {file.syncError && (
          <p className="banner warning">
            Chưa cập nhật được kết quả:{' '}
            {typeof file.syncError === 'string' ? file.syncError : 'máy chủ chưa phản hồi'}
          </p>
        )}
        {file.trackingExpired && (
          <p className="banner warning">
            Chưa nhận kết quả mới trong thời gian theo dõi. Trạng thái máy chủ chưa được thay đổi
            thành lỗi; bạn có thể kiểm tra lại.
          </p>
        )}
        {(file.reconciling || file.outcomeUnknown) && (
          <p className="banner warning">
            Lượt tải chưa được xác nhận đầy đủ. Hãy kiểm tra trạng thái trước khi tải lại để tránh
            tạo bản sao.
          </p>
        )}
      </div>
      <div className="drawer-footer">
        {file.mode === 'api' && file.remoteId && (
          <button className="button secondary" onClick={() => w.recheck?.(file.id)}>
            <RefreshCw size={16} />
            Kiểm tra lại
          </button>
        )}
        {file.original && (file.reconciling || file.outcomeUnknown) && (
          <button className="text-button" onClick={() => w.requestRetry?.(file.id)}>
            Chủ động tải lại…
          </button>
        )}
        <button className="button primary" onClick={close}>
          Đóng
        </button>
      </div>
    </aside>
  );
}

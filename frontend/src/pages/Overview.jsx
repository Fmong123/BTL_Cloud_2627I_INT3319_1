import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CircleAlert,
  CloudUpload,
  HardDrive,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useWorkspace } from '../state/Workspace.jsx';
import { isBusy } from '../utils/workspace.js';
import { isAttention, needsTracking } from '../utils/processing.js';
import { formatBytes } from '../utils/files.js';
import UploadButton from '../components/UploadButton.jsx';
import FileList from '../components/FileList.jsx';

export default function Overview() {
  const w = useWorkspace();
  const complete = w.files.filter((file) => file.status === 'success');
  const active = w.files.filter((file) => isBusy(file) || needsTracking(file));
  const errors = w.files.filter((file) => isAttention(file) || file.status === 'error');
  const quarantined = w.files.filter((file) => file.scanStatus === 'quarantined');
  const sync = w.sync || { phase: 'idle' };
  const partial = ['loading', 'partial'].includes(sync.phase);
  const bytes = complete.reduce((total, file) => total + file.size, 0);
  const stats = [
    [
      w.preferences.mode === 'api' && sync.phase !== 'disabled'
        ? 'Tệp trong thư viện'
        : 'Tệp trong phiên',
      w.files.length,
      '/files',
      HardDrive,
      'blue',
    ],
    ['Đang xử lý', active.length, '/files?status=active', CloudUpload, 'purple'],
    ['Cần chú ý', errors.length, '/files?area=attention', CircleAlert, 'pink'],
    [
      'Đã cách ly',
      quarantined.length,
      '/files?area=attention&scan=quarantined',
      ShieldCheck,
      'green',
    ],
  ];
  return (
    <>
      <p className="page-intro">
        Mọi thứ trong tầm tay. Bắt đầu với một tệp, hoặc tiếp tục công việc của bạn.
      </p>
      <UploadButton compact={w.files.length > 0} />
      {w.preferences.mode === 'api' && (
        <div className="overview-sync-note">
          <span>
            {partial
              ? `Đang đọc danh sách — số liệu tạm thời từ ${sync.loaded || 0} tệp đã tải.`
              : sync.phase === 'error'
                ? `Chưa đồng bộ được thư viện: ${sync.error || 'kiểm tra kết nối máy chủ'}`
                : sync.phase === 'disabled'
                  ? 'Metadata chưa được bật. Chỉ hiển thị các tệp trong phiên.'
                  : sync.lastSyncedAt
                    ? `Đồng bộ gần nhất: ${new Date(sync.lastSyncedAt).toLocaleTimeString('vi-VN')}`
                    : 'Đang kiểm tra khả năng đồng bộ danh sách…'}
          </span>
          <button className="text-button" disabled={partial} onClick={() => w.refreshFiles()}>
            <RefreshCw size={14} />
            Làm mới
          </button>
        </div>
      )}
      <div className="overview-stats">
        {stats.map(([label, count, to, Icon, color]) => (
          <Link className={`stat ${color} ${partial ? 'partial' : ''}`} key={label} to={to}>
            <span className="stat-label">
              <Icon size={18} />
              {label}
            </span>
            <strong>{count}</strong>
            <span className="stat-link">
              Xem chi tiết <ArrowRight size={14} />
            </span>
          </Link>
        ))}
      </div>
      <section className="files-section">
        <div className="files-heading">
          <div>
            <h2>Tệp mới nhất</h2>
            <p>
              {formatBytes(bytes)} đã được xác nhận tải lên
              {partial ? ' trong phần danh sách đã tải' : ''}
              {complete.some((file) => file.mode === 'demo')
                ? ` · gồm ${complete.filter((file) => file.mode === 'demo').length} tệp trải nghiệm`
                : ''}
            </p>
          </div>
          <Link className="text-button" to="/files">
            Xem tất cả <ArrowRight size={16} />
          </Link>
        </div>
        <FileList
          files={[...w.files].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5)}
          onInspect={w.inspect}
          onStar={(id) => w.star([id])}
          onRetry={(id) => w.retry([id])}
          onCancel={(id) => w.cancel([id])}
          onChoose={() => w.inputRef.current.click()}
          emptyTitle={
            partial
              ? 'Đang đọc thư viện'
              : sync.phase === 'error'
                ? 'Chưa đọc được danh sách'
                : 'Một khởi đầu thật gọn gàng'
          }
          emptyMessage={
            w.preferences.mode === 'demo'
              ? 'Tệp trải nghiệm vừa thêm sẽ xuất hiện ở đây, chỉ trong phiên hiện tại.'
              : partial
                ? 'Đang lấy metadata từ máy chủ. Tệp sẽ xuất hiện khi có phản hồi.'
                : sync.phase === 'error'
                  ? 'Kiểm tra kết nối rồi chọn Làm mới. Lỗi kết nối không có nghĩa là thư viện trống.'
                  : sync.phase === 'disabled'
                    ? 'Metadata chưa bật nên chưa thể lấy lại các tệp từ phiên trước.'
                    : 'Thêm tệp hoặc làm mới để lấy danh sách được máy chủ xác nhận.'
          }
        />
      </section>
      <div className="session-banner">
        <span>
          {w.preferences.mode === 'demo'
            ? 'Bạn đang trải nghiệm — chưa gửi nội dung tệp đến máy chủ.'
            : 'Tệp được gửi đến máy chủ đã cấu hình. Xem từng tệp để biết nơi lưu được xác nhận.'}
        </span>
        <Link to="/settings">
          Thiết lập lưu trữ <ArrowRight size={15} />
        </Link>
      </div>
    </>
  );
}

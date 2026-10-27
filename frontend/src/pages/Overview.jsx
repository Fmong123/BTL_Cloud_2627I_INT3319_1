import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, CircleAlert, CloudUpload, HardDrive } from 'lucide-react';
import { useWorkspace } from '../state/Workspace.jsx';
import { isBusy } from '../utils/workspace.js';
import { formatBytes } from '../utils/files.js';
import UploadButton from '../components/UploadButton.jsx';
import FileList from '../components/FileList.jsx';
import FileDetail from '../components/FileDetail.jsx';

export default function Overview() {
  const w = useWorkspace();
  const [inspected, setInspected] = useState(null);
  const complete = w.files.filter((file) => file.status === 'success');
  const active = w.files.filter(isBusy);
  const errors = w.files.filter((file) => file.status === 'error');
  const bytes = complete.reduce((total, file) => total + file.size, 0);
  const stats = [
    ['Tệp trong phiên', w.files.length, '/files', HardDrive, 'blue'],
    ['Đã hoàn tất', complete.length, '/files?status=success', Check, 'green'],
    ['Đang tải / chờ', active.length, '/uploads?status=active', CloudUpload, 'purple'],
    ['Cần kiểm tra', errors.length, '/uploads?status=error', CircleAlert, 'pink'],
  ];
  return (
    <>
      <p className="page-intro">
        Mọi thứ trong tầm tay. Bắt đầu với một tệp, hoặc tiếp tục công việc của bạn.
      </p>
      <UploadButton compact={w.files.length > 0} />
      <div className="overview-stats">
        {stats.map(([label, count, to, Icon, color]) => (
          <Link className={`stat ${color}`} key={label} to={to}>
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
            <h2>Tệp vừa thêm</h2>
            <p>
              {formatBytes(bytes)} hoàn tất trong phiên
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
          files={w.files.slice(0, 5)}
          onInspect={setInspected}
          onStar={(id) => w.star([id])}
          onRetry={(id) => w.retry([id])}
          onCancel={(id) => w.cancel([id])}
          onChoose={() => w.inputRef.current.click()}
          emptyTitle="Một khởi đầu thật gọn gàng"
          emptyMessage="Tệp vừa thêm sẽ xuất hiện ở đây. Danh sách của phiên trước không được giữ khi tải lại trang; tệp đã lưu vẫn có thể còn trên máy chủ."
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
      {inspected && <FileDetail id={inspected} onClose={() => setInspected(null)} />}
    </>
  );
}

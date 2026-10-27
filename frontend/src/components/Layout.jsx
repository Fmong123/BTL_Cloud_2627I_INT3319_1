import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Cloud,
  CloudUpload,
  HardDrive,
  LayoutDashboard,
  Layers2,
  Monitor,
  Moon,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Star,
  Sun,
  X,
} from 'lucide-react';
import { useWorkspace } from '../state/Workspace.jsx';
import { isBusy } from '../utils/workspace.js';
import { needsTracking } from '../utils/processing.js';
import Modal from './Modal.jsx';
import ConnectionMenu from './ConnectionMenu.jsx';
import NotificationCenter from './NotificationCenter.jsx';
import FileDetail from './FileDetail.jsx';
import '../shell-phase2.css';

export const themeLabels = {
  light: 'Sáng',
  dark: 'Tối',
  system: 'Theo hệ thống',
};
const navigation = [
  ['/overview', 'Tổng quan', LayoutDashboard],
  ['/files', 'Tệp của tôi', HardDrive],
  ['/uploads', 'Hoạt động xử lý', CloudUpload],
  ['/settings', 'Cài đặt', Settings2],
  ['/help', 'Hướng dẫn', CircleHelp],
];
const shortcuts = [
  ['recent', '/files?section=recent', 'Gần đây', Clock3],
  ['starred', '/files?section=starred', 'Đã đánh dấu', Star],
  ['quarantine', '/files?area=attention&scan=quarantined', 'Cách ly', ShieldCheck],
];

export default function Layout() {
  const w = useWorkspace();
  const location = useLocation();
  const navigate = useNavigate();
  const [themeOpen, setThemeOpen] = useState(false);
  const themeRef = useRef(null);
  const themeTrigger = useRef(null);
  const pageHeading = useRef(null);
  const [expanded, setExpanded] = useState(false);
  const params = new URLSearchParams(location.search);
  const shortcut =
    location.pathname === '/files'
      ? params.get('scan') === 'quarantined'
        ? 'quarantine'
        : ['recent', 'starred'].includes(params.get('section'))
          ? params.get('section')
          : null
      : null;
  const title =
    shortcuts.find(([key]) => key === shortcut)?.[2] ||
    navigation.find(([path]) => path === location.pathname)?.[1] ||
    'Không tìm thấy trang';
  const activity = w.activityFiles || w.files;
  const active = activity.filter(isBusy);
  const running = active.filter((file) => file.status === 'uploading');
  const queued = active.filter((file) => file.status === 'queued');
  const completed = activity.filter((file) => file.status === 'success');
  const errors = activity.filter((file) => file.status === 'error');
  const tracking = w.files.filter(needsTracking);
  const counts = {
    '/files': w.files.length,
    '/uploads': active.length || null,
    starred: w.files.filter((file) => file.starred).length || null,
    quarantine: w.files.filter((file) => file.scanStatus === 'quarantined').length || null,
  };
  function navItem(to, label, Icon, key = to) {
    const selected = shortcut ? key === shortcut : location.pathname === key;
    return (
      <Link
        key={key}
        to={to}
        className={`nav-item ${selected ? 'active' : ''}`}
        aria-current={selected ? 'page' : undefined}
      >
        <Icon size={19} aria-hidden="true" />
        <span>{label}</span>
        {counts[key] != null && (
          <span className="nav-count" aria-hidden="true">
            {counts[key]}
          </span>
        )}
      </Link>
    );
  }
  function focusSearch() {
    navigate('/files', { state: { focusSearch: Date.now() } });
  }

  useEffect(() => {
    document.title = `${title} · MâySec`;
    window.scrollTo(0, 0);
    if (!location.state?.focusSearch) pageHeading.current?.focus({ preventScroll: true });
  }, [location.pathname, title]);
  useEffect(() => {
    const onKey = (event) => {
      if (
        event.ctrlKey &&
        event.key.toLowerCase() === 'k' &&
        !event.altKey &&
        !event.metaKey &&
        !event.target.closest('input, textarea, select, [contenteditable="true"], dialog[open]')
      ) {
        event.preventDefault();
        focusSearch();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navigate]);
  useEffect(() => {
    if (!themeOpen) return;
    const outside = (event) => {
      if (!themeRef.current?.contains(event.target)) setThemeOpen(false);
    };
    const escape = (event) => {
      if (event.key === 'Escape') {
        setThemeOpen(false);
        themeTrigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [themeOpen]);

  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Đến nội dung chính
      </a>
      <aside className="sidebar">
        <Link to="/overview" className="brand">
          <span className="brand-mark">
            <Layers2 size={24} />
          </span>
          <span className="brand-wordmark">MâySec</span>
        </Link>
        <nav className="sidebar-navigation" aria-label="Điều hướng chính">
          <div className="nav-group">
            {navigation.slice(0, 3).map(([path, label, Icon]) => navItem(path, label, Icon))}
          </div>
          <div
            className="nav-group sidebar-shortcuts"
            role="group"
            aria-labelledby="shortcut-label"
          >
            <span className="nav-label" id="shortcut-label">
              LỐI TẮT
            </span>
            {shortcuts.map(([key, path, label, Icon]) => navItem(path, label, Icon, key))}
          </div>
          <div className="sidebar-bottom">
            {navigation.slice(3).map(([path, label, Icon]) => navItem(path, label, Icon))}
          </div>
        </nav>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <Cloud size={17} />
            <span>Không gian</span>
            <span>/</span>
            <strong>{title}</strong>
          </div>
          <div className="topbar-right">
            <button className="quick-search" onClick={focusSearch}>
              <Search size={17} />
              <span>Tìm kiếm tệp</span>
              <kbd>Ctrl K</kbd>
            </button>
            <NotificationCenter />
            <div className="theme-picker" ref={themeRef}>
              <button
                ref={themeTrigger}
                className="icon-button"
                aria-label="Chọn giao diện"
                aria-expanded={themeOpen}
                aria-controls="theme-options"
                onClick={() => setThemeOpen(!themeOpen)}
              >
                {w.preferences.theme === 'system' ? (
                  <Monitor size={20} />
                ) : w.preferences.theme === 'dark' ? (
                  <Moon size={20} />
                ) : (
                  <Sun size={20} />
                )}
              </button>
              {themeOpen && (
                <div id="theme-options" className="theme-menu" role="group" aria-label="Giao diện">
                  {Object.entries(themeLabels).map(([value, label]) => (
                    <button
                      key={value}
                      aria-pressed={w.preferences.theme === value}
                      onClick={() => {
                        w.setPreferences((p) => ({ ...p, theme: value }));
                        setThemeOpen(false);
                        themeTrigger.current?.focus();
                      }}
                    >
                      {label}
                      {w.preferences.theme === value && <Check size={16} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="button primary" onClick={() => w.inputRef.current.click()}>
              <Plus size={17} />
              Tải tệp lên
            </button>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <span className="eyebrow">KHÔNG GIAN CỦA BẠN</span>
              <h1 ref={pageHeading} tabIndex={-1}>
                {title}
              </h1>
            </div>
            <ConnectionMenu />
          </div>
          {!w.online && (
            <p className="banner warning" role="status">
              Trình duyệt báo đang mất mạng. Hãy kiểm tra kết nối; các tệp lỗi sẽ không tự gửi lại.
            </p>
          )}
          {w.storageFailed && (
            <p className="banner warning" role="status">
              Không thể ghi nhớ tùy chọn trên trình duyệt này. Bạn vẫn có thể dùng trong phiên hiện
              tại.
            </p>
          )}
          <Outlet />
          <footer className="page-footer">
            <span>Không gian nhỏ, những điều lớn</span>
            <span>MâySec · cloud storage</span>
          </footer>
        </main>
      </div>
      <input
        ref={w.inputRef}
        type="file"
        multiple
        className="visually-hidden"
        tabIndex={-1}
        aria-label="Chọn tệp để tải lên"
        onChange={(event) => {
          w.addFiles(Array.from(event.target.files));
          event.target.value = '';
        }}
      />
      {(active.length > 0 || tracking.length > 0) && (
        <section className="upload-dock" aria-label="Tiến trình tải lên">
          <button
            className="dock-toggle"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
          >
            <CloudUpload size={19} />
            <span>
              {active.length
                ? `${running.length} đang tải · ${queued.length} đang chờ`
                : `${tracking.length} tệp chờ kết quả xử lý`}
            </span>
            <ChevronDown size={16} />
          </button>
          {expanded && (
            <div className="dock-content">
              <div className="dock-running-files">
                {running.slice(0, 5).map((file) => (
                  <div className="dock-file" key={file.id}>
                    <div>
                      <span className="truncate">{file.name}</span>
                      <button
                        className="icon-button"
                        aria-label={`Hủy tải ${file.name} từ bảng tiến trình`}
                        onClick={() => w.cancel([file.id])}
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <progress
                      max="100"
                      value={file.progress || 0}
                      aria-label={`Tiến độ ${file.name} trong bảng tiến trình`}
                    />
                  </div>
                ))}
              </div>
              <p>
                {completed.length} đã tải xong · {errors.length} lỗi upload
              </p>
              <p>{tracking.length} tệp đang chờ kết quả quét / đối soát</p>
              <div className="inline-actions">
                <Link to="/uploads">
                  Xem hoạt động <ArrowRight size={14} />
                </Link>
                <button
                  disabled={!active.length}
                  onClick={() => w.cancel(active.map((file) => file.id))}
                >
                  Hủy tất cả
                </button>
              </div>
            </div>
          )}
        </section>
      )}
      <div className="sr-live" aria-live="polite">
        {active.length
          ? `${active.length} tệp đang tải hoặc chờ`
          : w.files.length
            ? `${completed.length} tệp hoàn tất, ${errors.length} tệp lỗi`
            : ''}
      </div>
      {(w.notice || w.undo || w.toasts?.length > 0) && (
        <div className="toast-stack">
          {(w.toasts || []).map((event) => (
            <div
              key={event.id}
              className={`toast event-toast ${event.tone}`}
              role={['warning', 'error'].includes(event.tone) ? 'alert' : 'status'}
            >
              <div>
                <strong>{event.title}</strong>
                <span>{event.message}</span>
              </div>
              {event.fileId && (
                <button
                  className="text-button"
                  onClick={() => {
                    navigate('/files');
                    w.inspect(event.fileId);
                    w.markRead(event.id);
                    w.dismissToast(event.id);
                  }}
                >
                  Xem tệp
                </button>
              )}
              <button
                className="icon-button"
                aria-label={`Đóng thông báo ${event.title}`}
                onClick={() => w.dismissToast(event.id)}
              >
                <X size={16} />
              </button>
            </div>
          ))}
          {w.notice && (
            <div className="toast" role="status">
              <span>{w.notice}</span>
              {w.notice.startsWith('Đã thêm') && <Link to="/files">Xem tệp vừa thêm</Link>}
              <button
                className="icon-button"
                aria-label="Đóng thông báo"
                onClick={() => w.setNotice(null)}
              >
                <X size={17} />
              </button>
            </div>
          )}
          {w.undo && (
            <div className="toast" role="status">
              <span>Đã bỏ {w.undo.length} tệp khỏi danh sách. Tệp trên máy chủ không bị xóa.</span>
              <button className="text-button" onClick={w.restore}>
                Hoàn tác
              </button>
            </div>
          )}
        </div>
      )}
      {w.inspectedId && <FileDetail />}
      {w.duplicates.length > 0 && (
        <Modal title="Có thể bạn đã thêm các tệp này" onClose={() => w.resolveDuplicates(false)}>
          <p>
            Có {w.duplicates.length} tệp cùng tên, kích thước và thời gian sửa với tệp trong phiên
            này. Tải thêm có thể tạo bản sao.
          </p>
          <ul className="duplicate-list">
            {w.duplicates.map((file, i) => (
              <li key={i}>{file.name}</li>
            ))}
          </ul>
          <div className="modal-footer">
            <button className="button secondary" onClick={() => w.resolveDuplicates(true)}>
              Vẫn tải thêm
            </button>
            <button autoFocus className="button primary" onClick={() => w.resolveDuplicates(false)}>
              Bỏ qua tệp trùng
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

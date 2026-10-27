import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
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
  Sun,
  X,
} from 'lucide-react';
import { useWorkspace } from '../state/Workspace.jsx';
import { isBusy } from '../utils/workspace.js';
import Modal from './Modal.jsx';

export const themeLabels = {
  light: 'Sáng',
  dark: 'Tối',
  system: 'Theo hệ thống',
};
const navigation = [
  ['/overview', 'Tổng quan', LayoutDashboard],
  ['/files', 'Tệp của tôi', HardDrive],
  ['/uploads', 'Hoạt động tải lên', CloudUpload],
  ['/settings', 'Cài đặt', Settings2],
  ['/help', 'Hướng dẫn', CircleHelp],
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
  const title =
    navigation.find(([path]) => path === location.pathname)?.[1] || 'Không tìm thấy trang';
  const active = w.files.filter(isBusy);
  const completed = w.files.filter((file) => file.status === 'success');
  const errors = w.files.filter((file) => file.status === 'error');
  const running = active.find((file) => file.status === 'uploading');
  function focusSearch() {
    navigate('/files', { state: { focusSearch: Date.now() } });
  }

  useEffect(() => {
    document.title = `${title} · MâySec`;
    window.scrollTo(0, 0);
    if (!location.state?.focusSearch) pageHeading.current?.focus({ preventScroll: true });
  }, [location.pathname]);
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
        <div className="workspace-label">
          <Cloud size={19} />
          <div>
            Không gian cá nhân<small>Lưu giữ điều quan trọng</small>
          </div>
        </div>
        <span className="nav-label">KHÔNG GIAN LÀM VIỆC</span>
        <nav aria-label="Điều hướng chính">
          {navigation.map(([path, label, Icon]) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon size={19} />
              <span>{label}</span>
              {path === '/files' && <span className="nav-count">{w.files.length}</span>}
              {path === '/uploads' && active.length > 0 && (
                <span className="nav-count">{active.length}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="session-note">
            <Cloud size={21} />
            <strong>Không gian trong phiên</strong>
            <p>Danh sách được giữ khi chuyển trang. Tải lại trang sẽ bắt đầu phiên mới.</p>
          </div>
          <span className="sidebar-signature">MâySec · Một nơi cho mọi tệp</span>
        </div>
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
            <Link className={`connection-pill ${w.preferences.mode}`} to="/settings">
              <span className="tiny-dot" />
              {w.preferences.mode === 'demo' ? 'Trải nghiệm' : 'Lưu trữ thật'}
              <ChevronDown size={14} />
            </Link>
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
      {active.length > 0 && (
        <section className="upload-dock" aria-label="Tiến trình tải lên">
          <button
            className="dock-toggle"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
          >
            <CloudUpload size={19} />
            <span>{active.length} tệp đang tải hoặc chờ</span>
            <ChevronDown size={16} />
          </button>
          {expanded && (
            <div className="dock-content">
              <p className="truncate">{running?.name || 'Đang chuẩn bị lượt tải'}</p>
              <progress
                max="100"
                value={running?.progress || 0}
                aria-label="Tiến độ tệp hiện tại"
              />
              <p>
                {completed.length} hoàn tất · {errors.length} lỗi
              </p>
              <div className="inline-actions">
                <Link to="/uploads">
                  Xem hoạt động <ArrowRight size={14} />
                </Link>
                <button onClick={() => w.cancel(active.map((file) => file.id))}>Hủy tất cả</button>
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
      {(w.notice || w.undo) && (
        <div className="toast-stack">
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

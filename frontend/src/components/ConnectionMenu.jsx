import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown, Settings2 } from 'lucide-react';
import { useWorkspace } from '../state/Workspace.jsx';

export default function ConnectionMenu() {
  const w = useWorkspace();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const trigger = useRef(null);
  const locked = w.busy || w.duplicates.length > 0;

  useEffect(() => {
    setOpen(false);
  }, [location.key]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus({ preventScroll: true });
      }
    };
    root.current.querySelector('input:checked:not(:disabled), a')?.focus({ preventScroll: true });
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('focusin', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  function choose(mode) {
    try {
      if (!w.saveConnection({ mode, baseUrl: w.preferences.baseUrl })) return;
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    } catch {
      w.notify(
        'Địa chỉ máy chủ chưa hợp lệ. Mở Cài đặt kết nối để sửa trước khi dùng lưu trữ thật.',
      );
    }
  }

  return (
    <div className="connection-picker" ref={root}>
      <button
        ref={trigger}
        type="button"
        className={`connection-pill ${w.preferences.mode}`}
        aria-expanded={open}
        aria-controls="storage-options"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="tiny-dot" />
        {w.preferences.mode === 'demo' ? 'Trải nghiệm' : 'Lưu trữ thật'}
        <ChevronDown size={14} />
      </button>
      {open && (
        <div id="storage-options" className="connection-menu">
          <fieldset disabled={locked}>
            <legend>Chế độ cho tệp mới</legend>
            <label>
              <input
                type="radio"
                name="quick-storage-mode"
                checked={w.preferences.mode === 'demo'}
                onChange={() => choose('demo')}
              />
              <span>
                <strong>Trải nghiệm giao diện</strong>
                <small>Mô phỏng, không gửi nội dung tệp.</small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="quick-storage-mode"
                checked={w.preferences.mode === 'api'}
                onChange={() => choose('api')}
              />
              <span>
                <strong>Lưu trữ thật</strong>
                <small>Gửi tệp đến máy chủ đã cấu hình.</small>
              </span>
            </label>
          </fieldset>
          {locked && (
            <p className="connection-menu-hint">Chờ hoặc hủy lượt tải trước khi đổi chế độ.</p>
          )}
          <p className="connection-server">
            <span>Máy chủ đã lưu</span>
            <strong>{w.preferences.baseUrl}</strong>
          </p>
          <Link to="/settings" onClick={() => setOpen(false)}>
            <Settings2 size={16} />
            Cài đặt kết nối
          </Link>
        </div>
      )}
    </div>
  );
}

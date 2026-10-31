import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, ChevronRight, CircleAlert, Inbox, X } from 'lucide-react';
import { useWorkspace } from '../state/Workspace.jsx';

export default function NotificationCenter() {
  const w = useWorkspace();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const root = useRef(null);
  const trigger = useRef(null);
  const heading = useRef(null);
  const notifications = w.notifications || [];
  const unread = notifications.filter((event) => !event.read).length;
  const visible = notifications.filter((event) =>
    filter === 'unread'
      ? !event.read
      : filter === 'attention'
        ? ['warning', 'error'].includes(event.tone)
        : true,
  );

  useEffect(() => {
    if (!open) return;
    heading.current?.focus({ preventScroll: true });
    const dismiss = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  function show(event) {
    w.markRead(event.id);
    setOpen(false);
    if (event.fileId) {
      const file = [...(w.allFiles || w.files), ...(w.activityFiles || [])].find(
        (item) => item.id === event.fileId || item.remoteId === event.fileId,
      );
      navigate(
        file?.lifecycleState === 'purged'
          ? '/uploads'
          : ['trashed', 'deleting'].includes(file?.lifecycleState)
            ? '/trash'
            : '/files',
      );
      w.inspect(event.fileId);
    } else {
      // A grouped upload event represents several files rather than one detail drawer.
      navigate(event.kind === 'sync-error' ? '/settings' : '/uploads');
    }
  }

  return (
    <div className="notification-center" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="icon-button notification-trigger"
        aria-label={`Thông báo${unread ? `, ${unread} chưa đọc` : ''}`}
        aria-expanded={open}
        aria-controls="notification-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={20} />
        {unread > 0 && (
          <span className="notification-count" aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <section
          id="notification-panel"
          className="notification-panel"
          role="region"
          aria-label="Thông báo"
        >
          <div className="notification-heading">
            <div>
              <h2 tabIndex={-1} ref={heading}>
                Thông báo
              </h2>
              <p>Thông báo đã lưu · trạng thái đọc được ghi nhớ</p>
            </div>
            <button
              className="icon-button"
              aria-label="Đóng thông báo"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <X size={18} />
            </button>
          </div>
          <div className="notification-tabs" role="group" aria-label="Lọc thông báo">
            {[
              ['all', 'Tất cả'],
              ['unread', 'Chưa đọc'],
              ['attention', 'Cần chú ý'],
            ].map(([value, label]) => (
              <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {label}
              </button>
            ))}
          </div>
          <div className="notification-actions">
            <span>{unread} chưa đọc</span>
            <button className="text-button" disabled={!unread} onClick={() => w.markRead()}>
              <CheckCheck size={15} />
              Đánh dấu tất cả đã đọc
            </button>
          </div>
          <div className="notification-events">
            {w.notificationStorageError && (
              <p className="banner warning" role="status">
                {w.notificationStorageError}
              </p>
            )}
            {visible.length ? (
              visible.map((event) => (
                <article
                  key={event.id}
                  className={`notification-event ${event.tone} ${event.read ? 'read' : 'unread'}`}
                >
                  <span className="notification-event-icon" aria-hidden="true">
                    {['warning', 'error'].includes(event.tone) ? (
                      <CircleAlert size={18} />
                    ) : (
                      <Bell size={17} />
                    )}
                  </span>
                  <div>
                    <button className="notification-event-title" onClick={() => show(event)}>
                      {event.title}
                      <ChevronRight size={13} />
                    </button>
                    <p>{event.message}</p>
                    <time dateTime={new Date(event.createdAt).toISOString()}>
                      {new Date(event.createdAt).toLocaleString('vi-VN', {
                        hour: '2-digit',
                        minute: '2-digit',
                        day: '2-digit',
                        month: '2-digit',
                      })}
                    </time>
                    {!event.read && (
                      <button className="notification-mark" onClick={() => w.markRead(event.id)}>
                        Đánh dấu đã đọc
                      </button>
                    )}
                  </div>
                </article>
              ))
            ) : (
              <div className="notification-empty">
                <Inbox size={29} />
                <strong>
                  {filter === 'unread'
                    ? 'Bạn đã xem hết thông báo'
                    : filter === 'attention'
                      ? 'Chưa có cảnh báo cần chú ý'
                      : 'Chưa có thông báo mới'}
                </strong>
                <p>Các thay đổi tải lên, quét và cách ly sẽ xuất hiện ở đây.</p>
              </div>
            )}
          </div>
          <p className="notification-footnote">
            Đây là các sự kiện web đã quan sát, không phải lịch sử kiểm toán đầy đủ.
          </p>
        </section>
      )}
    </div>
  );
}

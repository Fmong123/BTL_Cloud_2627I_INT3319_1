import { useEffect, useRef, useState } from 'react';
import { Download, Eye, Info, MoreHorizontal, RotateCcw, Star, X } from 'lucide-react';
import { canRetry, isBusy } from '../utils/workspace.js';
import { canReadContent, previewInfo, DOWNLOAD_LIMIT } from '../utils/content.js';

export default function FileActions({
  file,
  onStar,
  onInspect,
  onRetry,
  onCancel,
  onPreview,
  onDownload,
  canStar,
  contentAvailable = false,
  downloadingId,
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({});
  const ref = useRef(null);
  const trigger = useRef(null);
  const starAllowed =
    !file.starPending && (canStar ? canStar(file) : file.mode === 'demo') && Boolean(onStar);
  const info = previewInfo(file);
  const readable = contentAvailable && canReadContent(file);
  const downloadReason = !readable
    ? !contentAvailable
      ? 'Máy chủ chưa hỗ trợ mở nội dung'
      : 'Chỉ tải tệp đã lưu và không phát hiện dữ liệu nhạy cảm'
    : file.size > DOWNLOAD_LIMIT
      ? 'Tải xuống tối đa 100 MiB mỗi tệp'
      : downloadingId
        ? 'Đang chuẩn bị một tệp khác'
        : '';
  const contentReason = !contentAvailable
    ? 'Máy chủ chưa hỗ trợ mở nội dung'
    : info.reason || 'Chỉ mở nội dung tệp đã lưu và không phát hiện dữ liệu nhạy cảm';
  const starReason = file.starPending ? 'Đang lưu đánh dấu' : 'Máy chủ chưa hỗ trợ đánh dấu tệp';
  useEffect(() => {
    if (!open) return;
    const rect = trigger.current.getBoundingClientRect();
    setPosition({
      right: Math.max(12, window.innerWidth - rect.right),
      ...(rect.bottom + 345 > window.innerHeight
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
    });
    ref.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
    const outside = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    const followTrigger = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({
        right: Math.max(12, window.innerWidth - rect.right),
        ...(rect.bottom + 345 > window.innerHeight
          ? { bottom: window.innerHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
      });
    };
    window.addEventListener('scroll', followTrigger, true);
    window.addEventListener('resize', followTrigger);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('scroll', followTrigger, true);
      window.removeEventListener('resize', followTrigger);
    };
  }, [open]);
  function run(callback) {
    setOpen(false);
    trigger.current?.focus();
    callback?.(file.id);
  }
  return (
    <div className="file-actions" ref={ref}>
      <button
        className={`icon-button ${file.starred ? 'starred' : ''}`}
        title={starAllowed ? (file.starred ? 'Bỏ đánh dấu' : 'Đánh dấu') : starReason}
        aria-label={`${file.starred ? 'Bỏ đánh dấu' : 'Đánh dấu'} ${file.name}`}
        aria-pressed={file.starred}
        disabled={!starAllowed}
        onClick={() => onStar?.(file.id)}
      >
        <Star size={16} fill={file.starred ? 'currentColor' : 'none'} />
      </button>
      <button
        className="icon-button"
        title="Thông tin tệp"
        aria-label={`Thông tin ${file.name}`}
        onClick={() => onInspect?.(file.id)}
      >
        <Info size={17} />
      </button>
      <button
        ref={trigger}
        className="icon-button"
        aria-label={`Thao tác ${file.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div
          className="file-action-menu"
          style={position}
          role="menu"
          aria-label={`Thao tác với ${file.name}`}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              trigger.current?.focus();
            }
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              const items = [
                ...event.currentTarget.querySelectorAll('[role="menuitem"]:not(:disabled)'),
              ];
              const index = items.indexOf(document.activeElement);
              items[
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? items.length - 1
                    : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
              ]?.focus();
            }
            if (event.key === 'Tab') setOpen(false);
          }}
        >
          <button
            role="menuitem"
            disabled={!readable || !info.kind || !onPreview}
            title={!readable || !info.kind ? contentReason : undefined}
            onClick={() => run(onPreview)}
          >
            <Eye size={16} />
            Xem trước
          </button>
          <button role="menuitem" onClick={() => run(onInspect)}>
            <Info size={16} />
            Thông tin tệp
          </button>
          <button
            role="menuitem"
            disabled={!starAllowed}
            title={!starAllowed ? starReason : undefined}
            onClick={() => run(onStar)}
          >
            <Star size={16} />
            {file.starred ? 'Bỏ đánh dấu' : 'Đánh dấu'}
          </button>
          <button
            role="menuitem"
            disabled={Boolean(downloadReason) || !onDownload}
            title={downloadReason || undefined}
            onClick={() => run(onDownload)}
          >
            <Download size={16} />
            {downloadingId === file.id ? 'Đang tải xuống…' : 'Tải xuống'}
          </button>
          {!readable && <p className="file-action-reason">{contentReason}</p>}
          {readable && downloadReason && <p className="file-action-reason">{downloadReason}</p>}
          {readable && !info.kind && <p className="file-action-reason">{info.reason}</p>}
          {!starAllowed && <p className="file-action-reason">{starReason}</p>}
          {isBusy(file) && onCancel && (
            <button role="menuitem" onClick={() => run(onCancel)}>
              <X size={16} />
              Hủy tải lên
            </button>
          )}
          {canRetry(file) && onRetry && (
            <button role="menuitem" onClick={() => run(onRetry)}>
              <RotateCcw size={16} />
              Thử lại upload
            </button>
          )}
        </div>
      )}
    </div>
  );
}

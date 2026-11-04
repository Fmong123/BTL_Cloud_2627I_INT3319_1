import { useEffect, useRef } from 'react';
import { Download, Eye, Star, X } from 'lucide-react';
import { useWorkspace } from '../state/Workspace.jsx';
import { formatBytes } from '../utils/files.js';
import { downloadBlockReason, previewInfo } from '../utils/content.js';
import { scanStates } from '../utils/processing.js';

export default function FileSelectionDetail({ files, onClose, onClear }) {
  const w = useWorkspace();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const escape = (event) => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        !document.querySelector('dialog[open], [role="menu"]')
      ) {
        event.preventDefault();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('keydown', escape);
      if (
        previous?.isConnected &&
        (document.activeElement === document.body ||
          document.activeElement?.closest('.inline-file-detail'))
      ) {
        previous.focus({ preventScroll: true });
      }
    };
  }, []);
  const total = files.reduce((sum, file) => sum + (file.size || 0), 0);
  const readable = files.filter(
    (file) => !downloadBlockReason(file, { contentAvailable: w.contentAvailable }),
  );
  const starFiles = files.filter((file) => w.canStar(file));
  const counts = new Map();
  files.forEach((file) => {
    const label =
      file.mode === 'demo'
        ? 'Trải nghiệm'
        : scanStates[file.scanStatus]?.label || 'Chưa có kết quả';
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  return (
    <aside
      className="file-detail-drawer inline-file-detail selection-detail"
      role="region"
      aria-label="Nhóm tệp đã chọn"
    >
      <div className="drawer-heading">
        <h2>Nhóm tệp đã chọn</h2>
        <button className="icon-button" aria-label="Đóng chi tiết nhóm" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <div className="drawer-content">
        <div className="selection-summary" aria-live="polite">
          <strong>{files.length} tệp</strong>
          <p>{formatBytes(total)} tổng dung lượng</p>
        </div>
        <dl className="file-details">
          <div>
            <dt>Định dạng</dt>
            <dd>
              {[...new Set(files.map((file) => file.name.split('.').pop().toUpperCase()))].join(
                ' · ',
              )}
            </dd>
          </div>
          <div>
            <dt>Kết quả quét</dt>
            <dd>
              {[...counts].map(([label, count]) => (
                <p key={label}>
                  {label} <strong>× {count}</strong>
                </p>
              ))}
            </dd>
          </div>
          <div>
            <dt>Có thể tải</dt>
            <dd>
              {readable.length} / {files.length} tệp
            </dd>
          </div>
        </dl>
        {readable.length < files.length && (
          <p className="info-box">
            Chỉ mở hoặc tải tệp đã quét, không có cảnh báo. Tải xuống tối đa 100 MB mỗi tệp.
          </p>
        )}
        <ul className="selection-file-list">
          {files.map((file) => (
            <li key={file.id}>
              <button
                className="text-button selection-file-name"
                onClick={() => w.inspect(file.id)}
                title={file.name}
              >
                {file.name}
              </button>
              <div>
                {w.contentAvailable && previewInfo(file).kind && (
                  <button
                    className="icon-button"
                    aria-label={`Xem trước ${file.name}`}
                    title="Xem trước"
                    onClick={() => w.preview(file.id)}
                  >
                    <Eye size={18} />
                  </button>
                )}
                {readable.includes(file) && (
                  <button
                    className="icon-button"
                    aria-label={`Tải xuống ${file.name}`}
                    title="Tải xuống"
                    disabled={Boolean(w.downloadingId)}
                    onClick={() => w.download(file.id)}
                  >
                    <Download size={18} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="drawer-footer">
        {starFiles.length > 0 && (
          <button
            className="button secondary"
            onClick={() =>
              w.star(
                starFiles.map((file) => file.id),
                !starFiles.every((file) => file.starred),
              )
            }
          >
            <Star size={16} />
            {starFiles.every((file) => file.starred) ? 'Bỏ đánh dấu' : 'Đánh dấu'} (
            {starFiles.length})
          </button>
        )}
        <button className="text-button" onClick={onClear}>
          Bỏ chọn tất cả
        </button>
      </div>
    </aside>
  );
}

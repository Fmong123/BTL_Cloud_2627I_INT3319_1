import { useEffect, useState } from 'react';
import { Download, FileSearch, RefreshCw } from 'lucide-react';
import { useWorkspace } from '../state/Workspace.jsx';
import { getFileContent } from '../api/client.js';
import { canReadContent, previewInfo } from '../utils/content.js';
import { formatBytes } from '../utils/files.js';
import Modal from './Modal.jsx';
import StatusBadge from './StatusBadge.jsx';
import ScanBadge from './ScanBadge.jsx';

export default function FilePreview() {
  const w = useWorkspace();
  const file = w.files.find((item) => item.id === w.previewId);
  const info = previewInfo(file);
  const allowed = Boolean(w.contentAvailable && canReadContent(file));
  const [attempt, setAttempt] = useState(0);
  const [content, setContent] = useState({ phase: 'loading' });
  const id = file?.id;
  const remoteId = file?.remoteId;
  const kind = info.kind;
  const limit = info.limit;
  const baseUrl = w.preferences.baseUrl;

  useEffect(() => {
    if (file && !canReadContent(file)) {
      w.closePreview();
      w.inspect(file.id);
    }
  }, [id, file?.uploadState, file?.scanStatus]);

  useEffect(() => {
    const controller = new AbortController();
    let url;
    let current = true;
    setContent({ phase: 'loading' });
    if (allowed && kind && remoteId) {
      (async () => {
        try {
          const blob = await getFileContent(baseUrl, remoteId, {
            mode: 'preview',
            signal: controller.signal,
          });
          if (!current || controller.signal.aborted) return;
          const mime = blob.type.split(';')[0].trim().toLowerCase();
          const validMime =
            kind === 'image'
              ? ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime)
              : kind === 'pdf'
                ? mime === 'application/pdf'
                : ['text/plain', 'text/csv', 'application/json'].includes(mime);
          if (!validMime)
            throw new Error('Định dạng nội dung không khớp thông tin tệp. Hãy làm mới danh sách.');
          if (blob.size > limit)
            throw new Error('Tệp lớn hơn giới hạn xem trước. Hãy tải xuống để mở.');
          if (kind === 'text') {
            const text = new TextDecoder('utf-8', { fatal: true }).decode(await blob.arrayBuffer());
            if (current && !controller.signal.aborted) setContent({ phase: 'ready', text });
          } else {
            url = URL.createObjectURL(blob);
            setContent({ phase: 'ready', url });
          }
        } catch (error) {
          if (current && !controller.signal.aborted)
            setContent({
              phase: 'error',
              message: error.message || 'Chưa mở được nội dung. Hãy thử lại.',
            });
        }
      })();
    }
    return () => {
      current = false;
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, remoteId, baseUrl, w.scope, allowed, kind, limit, attempt]);

  const reason = !file
    ? 'Không tìm thấy tệp trong kết nối hiện tại.'
    : !w.contentAvailable
      ? 'Máy chủ chưa bật khả năng đọc nội dung tệp.'
      : info.reason;
  const ready = !reason && content.phase === 'ready';
  return (
    <Modal
      title={file?.name || 'Xem trước tệp'}
      onClose={w.closePreview}
      wide
      className="file-preview-modal"
    >
      {file && (
        <div className="preview-toolbar">
          <div>
            <StatusBadge {...file} />
            <ScanBadge {...file} />
            <span>{formatBytes(file.size)}</span>
          </div>
          <button
            className="button secondary"
            disabled={!allowed || Boolean(w.downloadingId)}
            onClick={() => w.download(file.id)}
          >
            <Download size={16} />
            {w.downloadingId === file.id ? 'Đang tải xuống…' : 'Tải xuống'}
          </button>
        </div>
      )}
      <div
        className={`preview-stage ${kind || ''}`}
        aria-busy={!reason && content.phase === 'loading'}
      >
        {reason ? (
          <div className="preview-message">
            <FileSearch size={34} />
            <p>{reason}</p>
          </div>
        ) : content.phase === 'loading' ? (
          <div className="preview-message" role="status">
            <RefreshCw size={24} className="spin" />
            <p>Đang mở nội dung…</p>
          </div>
        ) : content.phase === 'error' ? (
          <div className="preview-message" role="alert">
            <p>{content.message}</p>
            <button className="button secondary" onClick={() => setAttempt((value) => value + 1)}>
              Thử lại
            </button>
          </div>
        ) : ready && kind === 'text' ? (
          <pre className="preview-text" tabIndex={0} aria-label={`Nội dung ${file.name}`}>
            {content.text}
          </pre>
        ) : ready && kind === 'image' ? (
          <img
            src={content.url}
            alt={`Xem trước ${file.name}`}
            onError={() =>
              setContent({
                phase: 'error',
                message: 'Không hiển thị được ảnh. Bạn có thể tải xuống để mở trên thiết bị.',
              })
            }
          />
        ) : ready && kind === 'pdf' ? (
          <iframe src={content.url} title={`Xem trước PDF ${file.name}`} />
        ) : null}
      </div>
      {kind === 'pdf' && !reason && (
        <p className="preview-hint">
          Nếu trình duyệt không hiển thị PDF, chọn Tải xuống để mở trên thiết bị.
        </p>
      )}
    </Modal>
  );
}

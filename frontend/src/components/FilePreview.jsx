import { useEffect, useState } from 'react';
import { Download, ExternalLink, FileSearch, Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import { useWorkspace } from '../state/Workspace.jsx';
import { getFileContent } from '../api/client.js';
import { canReadContent, previewInfo, downloadBlockReason } from '../utils/content.js';
import { formatBytes } from '../utils/files.js';
import Modal from './Modal.jsx';
import StatusBadge from './StatusBadge.jsx';
import ScanBadge from './ScanBadge.jsx';

export default function FilePreview() {
  const w = useWorkspace();
  const file = w.files.find((item) => item.id === w.previewId);
  const info = previewInfo(file);
  const allowed = Boolean(w.contentAvailable && canReadContent(file));
  const downloadReason = downloadBlockReason(file, {
    contentAvailable: w.contentAvailable,
    downloadingId: w.downloadingId,
  });
  const [attempt, setAttempt] = useState(0);
  const [content, setContent] = useState({ phase: 'loading' });
  const [expanded, setExpanded] = useState(false);
  const [pdfControls, setPdfControls] = useState(false);
  const [imageZoom, setImageZoom] = useState('fit');
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
      className={`file-preview-modal${expanded ? ' expanded' : ''}`}
    >
      {file && (
        <div className="preview-toolbar">
          <div>
            <StatusBadge {...file} />
            <ScanBadge {...file} />
            <span>{formatBytes(file.size)}</span>
          </div>
          <div className="preview-actions">
            {ready && kind === 'pdf' && (
              <button
                className="button secondary"
                aria-pressed={pdfControls}
                onClick={() => setPdfControls(!pdfControls)}
              >
                {pdfControls ? 'Ẩn thanh PDF' : 'Hiện thanh PDF'}
              </button>
            )}
            {ready && kind === 'image' && (
              <select
                aria-label="Thu phóng ảnh"
                value={imageZoom}
                onChange={(event) => setImageZoom(event.target.value)}
              >
                <option value="fit">Vừa khung</option>
                <option value="100">100% chiều rộng</option>
                <option value="150">150% chiều rộng</option>
                <option value="200">200% chiều rộng</option>
              </select>
            )}
            {ready && content.url && (
              <a
                className="button secondary"
                href={content.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={16} /> Mở tab mới
              </a>
            )}
            <button
              className="button secondary"
              aria-pressed={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              {expanded ? 'Thu khung' : 'Mở rộng'}
            </button>
            <button
              className="button secondary"
              disabled={Boolean(downloadReason)}
              title={downloadReason || undefined}
              onClick={() => w.download(file.id)}
            >
              <Download size={16} />
              {w.downloadingId === file.id ? 'Đang tải xuống…' : 'Tải xuống'}
            </button>
          </div>
        </div>
      )}
      <div
        className={`preview-stage ${kind || ''}${kind === 'image' && imageZoom !== 'fit' ? ' zoomed' : ''}`}
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
            style={imageZoom === 'fit' ? undefined : { width: `${imageZoom}%` }}
            alt={`Xem trước ${file.name}`}
            onError={() =>
              setContent({
                phase: 'error',
                message: 'Không hiển thị được ảnh. Bạn có thể tải xuống để mở trên thiết bị.',
              })
            }
          />
        ) : ready && kind === 'pdf' ? (
          <iframe
            key={String(pdfControls)}
            src={`${content.url}#toolbar=${Number(pdfControls)}&navpanes=0&view=FitH`}
            title={`Xem trước PDF ${file.name}`}
          />
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

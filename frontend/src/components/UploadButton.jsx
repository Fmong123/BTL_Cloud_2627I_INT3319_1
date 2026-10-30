import { useRef, useState } from 'react';
import { ArrowUpRight, CloudUpload, Plus } from 'lucide-react';
import { useWorkspace } from '../state/Workspace.jsx';
import { formatBytes } from '../utils/files.js';

export default function UploadButton({ compact = false }) {
  const w = useWorkspace();
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  return (
    <section
      className={`upload-zone ${compact ? 'compact' : ''} ${dragging ? 'dragging' : ''}`}
      aria-label="Khu vực tải tệp lên"
      onDragEnter={(event) => {
        if (!Array.from(event.dataTransfer.types).includes('Files')) return;
        event.preventDefault();
        depth.current++;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (!Array.from(event.dataTransfer.types).includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        depth.current = 0;
        setDragging(false);
        w.addFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <div className="upload-copy">
        <span className="eyebrow">
          {compact ? 'THÊM TỆP VÀO KHÔNG GIAN' : 'MỘT NƠI CHO MỌI TỆP'}
        </span>
        <h2>
          {compact ? (
            'Thêm tệp, tiếp tục công việc'
          ) : (
            <>
              Gọn gàng hơn.
              <br />
              Nhẹ nhàng hơn.
            </>
          )}
        </h2>
        <p>Kéo thả tệp vào đây hoặc chọn từ máy tính của bạn.</p>
        <div className="upload-cta">
          <button className="button primary" onClick={() => w.inputRef.current.click()}>
            <Plus size={18} />
            Chọn tệp
            <ArrowUpRight size={16} />
          </button>
          <span>
            Tối đa {formatBytes(w.limit)} / tệp
            {!w.health && w.preferences.mode === 'api' ? ' · chưa xác minh' : ''}
          </span>
        </div>
      </div>
      {!compact && (
        <div className="upload-art" aria-hidden="true">
          <div className="floating-sheet">
            <CloudUpload size={52} strokeWidth={1.3} />
            <span />
            <span />
            <span />
          </div>
          <span className="art-caption">a little more space</span>
        </div>
      )}
      {dragging && (
        <div className="drop-overlay">
          <CloudUpload size={35} />
          <strong>Thả tệp để bắt đầu</strong>
        </div>
      )}
    </section>
  );
}

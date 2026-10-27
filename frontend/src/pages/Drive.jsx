import { CloudUpload } from 'lucide-react';
import { useState } from 'react';
import { useWorkspace } from '../state/Workspace.jsx';
import { formatBytes } from '../utils/files.js';
import FileBrowser from '../components/FileBrowser.jsx';

export default function Drive() {
  const w = useWorkspace();
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className="drive-workspace"
      onDragOver={(event) => {
        if (Array.from(event.dataTransfer.types).includes('Files')) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        w.addFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <div className="drive-toolbar-note">
        <span>Kéo thả tệp vào không gian này · tối đa {formatBytes(w.limit)} / tệp</span>
        <button className="text-button" onClick={() => w.inputRef.current.click()}>
          <CloudUpload size={16} />
          Thêm tệp
        </button>
      </div>
      <FileBrowser />
      {dragging && (
        <div className="drive-drop-overlay">
          <CloudUpload size={38} />
          <strong>Thả tệp để tải lên</strong>
          <span>Các tệp được xếp hàng, tối đa 5 lượt tải song song</span>
        </div>
      )}
    </div>
  );
}

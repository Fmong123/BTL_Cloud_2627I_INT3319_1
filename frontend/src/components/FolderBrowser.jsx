import { useEffect, useRef, useState } from 'react';
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  Home,
  MoreHorizontal,
  Pencil,
  FolderInput,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { useWorkspace } from '../state/Workspace.jsx';
import { folderPath } from '../state/useFolders.js';
import { normalizedSearch } from '../utils/files.js';
import { changeFolder, moveFilesToFolder } from '../api/client.js';
import '../folders.css';

export const FILE_DRAG_TYPE = 'application/x-maysec-files';
const FOLDER_DRAG_TYPE = 'application/x-maysec-folder';

export default function FolderBrowser({
  folder,
  onFolder,
  onAction,
  query = '',
  onDropComplete,
  onTargetDrag,
}) {
  const w = useWorkspace();
  const [dropTarget, setDropTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const ref = useRef(null);
  const { active: folders, loading, error } = w.folders;
  const currentId = ['root', 'all'].includes(folder) ? null : folder;
  const current = folders.find((item) => item.id === currentId);
  const path = folderPath(folders, currentId);
  const invalid = currentId && !current && !loading && !error;
  const children = folders.filter(
    (item) =>
      (folder === 'all' || (item.parent_id || null) === currentId) &&
      normalizedSearch(item.name).includes(normalizedSearch(query)),
  );
  useEffect(() => {
    const outside = (e) =>
      ref.current?.querySelectorAll('details[open]').forEach((menu) => {
        if (!menu.contains(e.target)) menu.open = false;
      });
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  function dragOver(event, target) {
    if (
      ![FILE_DRAG_TYPE, FOLDER_DRAG_TYPE, 'Files'].some((type) =>
        Array.from(event.dataTransfer.types).includes(type),
      )
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    onTargetDrag?.();
    event.dataTransfer.dropEffect = Array.from(event.dataTransfer.types).includes('Files')
      ? 'copy'
      : 'move';
    setDropTarget(target || 'root');
  }
  async function drop(event, target) {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    if (busy) return;
    if (event.dataTransfer.files.length) {
      w.addFiles(Array.from(event.dataTransfer.files), target);
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const text =
        event.dataTransfer.getData(FILE_DRAG_TYPE) || event.dataTransfer.getData(FOLDER_DRAG_TYPE);
      const data = JSON.parse(text);
      if (data.scope !== w.scope) throw new Error('Tệp/thư mục không thuộc phiên hiện tại');
      if (data.fileIds) {
        const files = w.files.filter((file) => data.fileIds.includes(file.remoteId));
        if (
          !files.length ||
          files.length !== data.fileIds.length ||
          files.some((file) => file.uploadState !== 'uploaded')
        )
          throw new Error('Hãy chọn tệp đã tải lên');
        await moveFilesToFolder(w.preferences.baseUrl, data.fileIds, target);
      } else await changeFolder(w.preferences.baseUrl, data.folderId, 'move', target);
      w.refreshFiles();
      onDropComplete();
      w.notify('Đã di chuyển vào thư mục');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }
  const dropProps = (id) => ({
    onDragOver: (e) => dragOver(e, id),
    onDrop: (e) => drop(e, id),
    onDragLeave: () => setDropTarget(null),
  });
  const action = (kind, item) =>
    onAction({
      kind,
      folder: item,
      parentId: currentId,
      leaveFolder: kind === 'trash' && path.some((parent) => parent.id === item.id),
    });
  return (
    <section className="folder-browser" aria-label="Thư mục của tôi" ref={ref}>
      <div className="folder-navigation">
        <nav className="folder-breadcrumbs" aria-label="Đường dẫn thư mục">
          <button
            className={dropTarget === 'root' ? 'is-drop-target' : ''}
            onClick={() => onFolder('root')}
            {...dropProps(null)}
          >
            <Home size={17} />
            Tệp của tôi
          </button>
          {folder === 'all' && (
            <span>
              <ChevronRight size={14} />
              <strong>Tất cả tệp</strong>
            </span>
          )}
          {path.map((item, index) => (
            <span key={item.id}>
              <ChevronRight size={14} />
              <button
                aria-current={index === path.length - 1 ? 'page' : undefined}
                onClick={() => onFolder(item.id)}
                {...dropProps(item.id)}
              >
                {item.name}
              </button>
            </span>
          ))}
        </nav>
        <div className="inline-actions">
          <button
            className="text-button"
            onClick={() => onFolder(folder === 'all' ? 'root' : 'all')}
          >
            {folder === 'all' ? 'Về thư mục gốc' : 'Xem tất cả tệp'}
          </button>
          <button
            className="button secondary folder-create"
            disabled={loading || Boolean(error) || Boolean(invalid) || busy}
            onClick={() => onAction({ kind: 'create', parentId: currentId })}
          >
            <FolderPlus size={18} />
            Thư mục mới
          </button>
        </div>
      </div>
      {current && (
        <div className="folder-current-actions">
          <FolderOpen size={17} />
          <strong>{current.name}</strong>
          <button className="text-button" onClick={() => action('rename', current)}>
            <Pencil size={15} />
            Đổi tên
          </button>
          <button className="text-button" onClick={() => action('move-folder', current)}>
            <FolderInput size={15} />
            Di chuyển
          </button>
          <button className="text-button" onClick={() => action('trash', current)}>
            <Trash2 size={15} />
            Thùng rác
          </button>
        </div>
      )}
      {(error || message) && (
        <p role="alert" className="banner warning">
          {error || message}{' '}
          <button
            className="text-button"
            onClick={() => {
              setMessage('');
              w.folders.refresh();
            }}
          >
            <RefreshCw size={14} />
            Thử lại
          </button>
        </p>
      )}
      {invalid && (
        <p className="banner warning" role="status">
          Thư mục không còn ở vị trí này hoặc đã được đưa vào Thùng rác.{' '}
          <button className="text-button" onClick={() => onFolder('root')}>
            Về Tệp của tôi
          </button>
        </p>
      )}
      {loading && !folders.length ? (
        <p className="folder-status" role="status">
          Đang đọc thư mục…
        </p>
      ) : (
        !invalid && (
          <>
            <div className="folder-section-label">
              <h3>
                Thư mục <span>{children.length}</span>
              </h3>
              <p>Mở thư mục hoặc kéo tệp vào đây</p>
            </div>
            <div className="folder-grid">
              {children.map((item) => (
                <article
                  key={item.id}
                  className={`folder-card ${dropTarget === item.id ? 'is-drop-target' : ''}`}
                  draggable={!busy}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      FOLDER_DRAG_TYPE,
                      JSON.stringify({ scope: w.scope, folderId: item.id }),
                    );
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  {...dropProps(item.id)}
                >
                  <button
                    className="folder-card-open"
                    onClick={() => onFolder(item.id)}
                    title={item.name}
                    aria-label={`Mở thư mục ${item.name}`}
                  >
                    <Folder size={29} fill="currentColor" strokeWidth={1.3} />
                    <span>{item.name}</span>
                  </button>
                  <details
                    className="folder-menu"
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        e.currentTarget.open = false;
                        e.currentTarget.querySelector('summary').focus();
                      }
                    }}
                  >
                    <summary aria-label={`Thao tác thư mục ${item.name}`} title="Thao tác thư mục">
                      <MoreHorizontal size={19} />
                    </summary>
                    <div className="folder-menu-items">
                      {[
                        ['rename', Pencil, 'Đổi tên'],
                        ['move-folder', FolderInput, 'Di chuyển đến…'],
                        ['trash', Trash2, 'Chuyển vào Thùng rác'],
                      ].map(([kind, Icon, label]) => (
                        <button
                          key={kind}
                          onClick={(e) => {
                            const menu = e.currentTarget.closest('details');
                            menu.open = false;
                            menu.querySelector('summary').focus();
                            action(kind, item);
                          }}
                        >
                          <Icon size={16} />
                          {label}
                        </button>
                      ))}
                    </div>
                  </details>
                </article>
              ))}
              {!children.length && !query && !error && (
                <button
                  className="folder-empty-create"
                  disabled={busy || loading}
                  onClick={() => onAction({ kind: 'create', parentId: currentId })}
                >
                  <FolderPlus size={24} />
                  <span>Tạo thư mục để sắp xếp tài liệu</span>
                </button>
              )}
              {!children.length && query && (
                <p className="folder-status">Không có thư mục phù hợp.</p>
              )}
            </div>
          </>
        )
      )}
    </section>
  );
}

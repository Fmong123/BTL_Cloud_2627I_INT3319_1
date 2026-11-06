import { useState } from 'react';
import { ChevronRight, Folder, FolderPlus, Home } from 'lucide-react';
import Modal from './Modal.jsx';
import { useWorkspace } from '../state/Workspace.jsx';
import { folderPath } from '../state/useFolders.js';
import { changeFolder, moveFilesToFolder, saveFolder } from '../api/client.js';
import { normalizedSearch } from '../utils/files.js';

const titles = {
  create: 'Thư mục mới',
  rename: 'Đổi tên thư mục',
  'move-folder': 'Di chuyển thư mục',
  'move-files': 'Di chuyển tệp',
  trash: 'Chuyển thư mục vào Thùng rác',
  restore: 'Khôi phục thư mục',
  purge: 'Xóa vĩnh viễn thư mục',
};

export default function FolderDialogs({ action, onClose, onNavigate }) {
  const w = useWorkspace();
  const [name, setName] = useState(action.kind === 'rename' ? action.folder.name : '');
  const [destination, setDestination] = useState(
    action.destination ?? action.folder?.parent_id ?? action.parentId ?? null,
  );
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const moving = action.kind.startsWith('move-');
  const naming = ['create', 'rename'].includes(action.kind);
  const folders = w.folders.active;
  const path = folderPath(folders, destination);
  const excluded = (item) =>
    action.kind === 'move-folder' &&
    (item.id === action.folder.id ||
      folderPath(folders, item.id).some((parent) => parent.id === action.folder.id));
  const children = folders.filter(
    (item) =>
      (item.parent_id || null) === destination &&
      !excluded(item) &&
      normalizedSearch(item.name).includes(normalizedSearch(query)),
  );
  const navigate = (id) => {
    setDestination(id);
    setQuery('');
    setCreating(false);
    setError('');
  };
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      let result;
      const base = w.preferences.baseUrl;
      if (naming)
        result = await saveFolder(
          base,
          action.kind === 'rename' ? action.folder.id : null,
          name.trim(),
          action.parentId || null,
        );
      else if (action.kind === 'move-folder')
        result = await changeFolder(base, action.folder.id, 'move', destination);
      else if (action.kind === 'move-files')
        result = await moveFilesToFolder(
          base,
          action.files.map((file) => file.remoteId),
          destination,
        );
      else result = await changeFolder(base, action.folder.id, action.kind);
      w.refreshFiles();
      if (action.kind === 'trash' && action.leaveFolder)
        onNavigate?.(action.folder.parent_id || 'root');
      if (action.kind === 'create' && action.openCreated) onNavigate?.(result.id);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={titles[action.kind]}
      onClose={() => !busy && onClose()}
      className="folder-dialog"
      wide={moving}
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          {naming && (
            <label className="folder-name-field">
              Tên thư mục
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                required
                placeholder="Ví dụ: Hồ sơ nhân sự"
                disabled={busy}
              />
              {action.kind === 'create' && (
                <span>
                  Tạo trong{' '}
                  {[
                    'Tệp của tôi',
                    ...folderPath(folders, action.parentId).map((item) => item.name),
                  ].join(' / ')}
                </span>
              )}
            </label>
          )}
          {moving && (
            <>
              <p className="folder-dialog-intro">
                {action.kind === 'move-files'
                  ? `${action.files.length} tệp đã chọn`
                  : action.folder.name}{' '}
                · Chọn thư mục đích
              </p>
              <nav className="folder-breadcrumbs" aria-label="Vị trí đích">
                <button type="button" onClick={() => navigate(null)} disabled={busy}>
                  <Home size={16} />
                  Tệp của tôi
                </button>
                {path.map((item) => (
                  <span key={item.id}>
                    <ChevronRight size={14} />
                    <button type="button" onClick={() => navigate(item.id)} disabled={busy}>
                      {item.name}
                    </button>
                  </span>
                ))}
              </nav>
              <input
                className="folder-picker-search"
                aria-label="Tìm thư mục đích"
                placeholder="Tìm thư mục tại vị trí này…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={busy}
              />
              <div className="folder-picker-list" aria-label="Thư mục đích">
                {children.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={busy}
                    onClick={() => navigate(item.id)}
                  >
                    <Folder size={22} />
                    <span>{item.name}</span>
                    <ChevronRight size={17} />
                  </button>
                ))}
                {!children.length && (
                  <p>
                    {query
                      ? 'Không tìm thấy thư mục phù hợp.'
                      : 'Không có thư mục con. Bạn có thể chuyển vào vị trí này.'}
                  </p>
                )}
              </div>
              {creating ? (
                <div className="folder-inline-create">
                  <input
                    autoFocus
                    aria-label="Tên thư mục đích mới"
                    maxLength={120}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    disabled={busy}
                  />
                  <button
                    type="button"
                    className="button secondary"
                    disabled={!newName.trim() || busy}
                    onClick={async () => {
                      setBusy(true);
                      setError('');
                      try {
                        const result = await saveFolder(
                          w.preferences.baseUrl,
                          null,
                          newName.trim(),
                          destination,
                        );
                        w.folders.refresh();
                        navigate(result.id);
                        setNewName('');
                      } catch (err) {
                        setError(err.message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Tạo
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => setCreating(false)}
                  >
                    Hủy
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="text-button folder-picker-create"
                  disabled={busy}
                  onClick={() => setCreating(true)}
                >
                  <FolderPlus size={17} />
                  Thư mục mới ở đây
                </button>
              )}
              <p className="folder-destination">
                Di chuyển đến: <strong>{path.at(-1)?.name || 'Tệp của tôi'}</strong>
              </p>
            </>
          )}
          {action.kind === 'trash' && (
            <p>
              Đưa <strong>{action.folder.name}</strong> cùng thư mục con và các tệp bên trong vào
              Thùng rác trong 30 ngày. Nội dung vẫn tính dung lượng và có thể khôi phục. Tệp đang
              tải/quét phải xử lý xong trước.
            </p>
          )}
          {action.kind === 'restore' && (
            <p>
              Khôi phục <strong>{action.folder.name}</strong> cùng nội dung còn trong Thùng rác về
              vị trí ban đầu. Nếu thư mục cha không còn, thư mục sẽ trở về Tệp của tôi.
            </p>
          )}
          {action.kind === 'purge' && (
            <p>
              Xóa vĩnh viễn <strong>{action.folder.name}</strong> cùng nội dung bên trong. Thao tác
              này không thể khôi phục.
            </p>
          )}
          {error && (
            <p className="banner error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            Hủy
          </button>
          <button
            className={`button ${['trash', 'purge'].includes(action.kind) ? 'danger' : 'primary'}`}
            disabled={busy || (naming && !name.trim()) || (moving && w.folders.loading) || creating}
          >
            {busy
              ? 'Đang thực hiện…'
              : {
                  create: 'Tạo thư mục',
                  rename: 'Lưu tên',
                  trash: 'Chuyển vào Thùng rác',
                  restore: 'Khôi phục',
                  purge: 'Xóa vĩnh viễn',
                  'move-folder': 'Di chuyển đến đây',
                  'move-files': 'Di chuyển đến đây',
                }[action.kind]}
          </button>
        </div>
      </form>
    </Modal>
  );
}

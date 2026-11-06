import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Folder, RefreshCw, RotateCcw, Search, Trash2 } from 'lucide-react';
import { useWorkspace } from '../state/Workspace.jsx';
import { formatBytes, normalizedSearch } from '../utils/files.js';
import FileIcon from '../components/FileIcon.jsx';
import ScanBadge from '../components/ScanBadge.jsx';
import FolderDialogs from '../components/FolderDialogs.jsx';
import Modal from '../components/Modal.jsx';
import { changeFile, changeFolder } from '../api/client.js';
import '../folders.css';
import '../file-workspace.css';

const PAGE_SIZE = 50;
export default function Trash() {
  const w = useWorkspace();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [page, setPage] = useState(1);
  const [now, setNow] = useState(Date.now());
  const [folderAction, setFolderAction] = useState(null);
  const [emptyDialog, setEmptyDialog] = useState(false);
  const [emptyBusy, setEmptyBusy] = useState(false);
  const [emptyError, setEmptyError] = useState('');
  useEffect(() => {
    setSelected(new Set());
    setPage(1);
  }, [query, w.scope]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const folderGroups = w.folders.trash;
  const shownFolders = folderGroups.filter(
    (item) =>
      normalizedSearch(item.name).includes(normalizedSearch(query)) ||
      w.trashFiles.some(
        (file) =>
          file.trashRootId === item.id &&
          normalizedSearch(file.name).includes(normalizedSearch(query)),
      ),
  );
  const grouped = new Set(folderGroups.map((item) => item.id));
  const all = w.trashFiles
    .filter((file) => !grouped.has(file.trashRootId))
    .sort((a, b) => b.trashedAt - a.trashedAt);
  const filtered = all.filter((file) =>
    normalizedSearch(file.name).includes(normalizedSearch(query)),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const chosen = filtered.filter((file) => selected.has(file.id));
  const loading =
    w.preferences.mode === 'api' && ['idle', 'loading', 'partial'].includes(w.sync.phase);
  const canRestore = (file) =>
    file.lifecycleState === 'trashed' && file.trashExpiresAt > now && w.canManage(file);
  const date = (stamp) => (stamp ? new Date(stamp).toLocaleDateString('vi-VN') : '—');
  async function emptyTrash(event) {
    event.preventDefault();
    setEmptyBusy(true);
    setEmptyError('');
    try {
      for (const folder of folderGroups)
        await changeFolder(w.preferences.baseUrl, folder.id, 'purge');
      for (const file of all) await changeFile(w.preferences.baseUrl, file.remoteId, 'purge');
      setEmptyDialog(false);
      setSelected(new Set());
      w.notify('Đã dọn sạch Thùng rác');
    } catch (error) {
      setEmptyError(
        `Chưa dọn xong toàn bộ Thùng rác: ${error.message}. Nội dung đã xóa thành công sẽ được cập nhật khi làm mới.`,
      );
    } finally {
      setEmptyBusy(false);
      w.refreshFiles();
    }
  }
  return (
    <section className="files-section trash-section" aria-label="Thùng rác">
      <div className="trash-heading">
        <div>
          <h2>Thùng rác</h2>
          <p>Giữ 30 ngày · Vẫn tính vào dung lượng.</p>
        </div>
        <div className="inline-actions">
          <button className="button secondary" onClick={w.refreshFiles} disabled={loading}>
            <RefreshCw size={16} />
            Làm mới
          </button>
          <button
            className="button danger"
            disabled={
              (!all.length && !folderGroups.length) ||
              loading ||
              w.folders.loading ||
              Boolean(w.folders.error) ||
              w.sync.phase === 'error' ||
              w.changingFiles ||
              emptyBusy
            }
            onClick={() =>
              w.preferences.mode === 'api'
                ? (setEmptyError(''), setEmptyDialog(true))
                : w.requestFileChange(
                    'purge',
                    all.map((file) => file.id),
                  )
            }
          >
            <Trash2 size={16} />
            Dọn sạch thùng rác
          </button>
        </div>
      </div>
      {!w.lifecycleAvailable && (
        <p className="banner warning">Máy chủ chưa bật chức năng Thùng rác.</p>
      )}
      {w.sync.phase === 'error' && (
        <p className="banner warning" role="status">
          Chưa đồng bộ đủ Thùng rác: {w.sync.error}
        </p>
      )}
      {w.folders.error && (
        <p role="alert" className="banner warning">
          Chưa đọc được thư mục trong Thùng rác: {w.folders.error}
        </p>
      )}
      <div className="trash-toolbar">
        <div className="trash-search">
          <Search size={18} />
          <input
            aria-label="Tìm trong Thùng rác"
            placeholder="Tìm trong Thùng rác…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <span className="trash-count" aria-label="Số tệp trong Thùng rác">
          {shownFolders.length > 0 ? `${shownFolders.length} thư mục · ` : ''}
          {filtered.length === all.length ? all.length : `${filtered.length} / ${all.length}`} tệp
          rời
        </span>
      </div>
      {(folderGroups.length > 0 || w.folders.loading) && (
        <section className="folder-trash" aria-label="Thư mục trong Thùng rác">
          <div className="folder-trash-heading">
            <Folder size={20} />
            <h3>Thư mục đã xóa · {shownFolders.length}</h3>
          </div>
          <ul className="folder-trash-list">
            {shownFolders.map((folder) => (
              <li key={folder.id}>
                <div className="folder-trash-name">
                  <Folder size={25} />
                  <div>
                    <strong>{folder.name}</strong>
                    <small>
                      {w.trashFiles.filter((file) => file.trashRootId === folder.id).length} tệp bên
                      trong · Xóa ngày {date(Date.parse(folder.trashed_at))}
                    </small>
                    <small>
                      {folder.purging
                        ? 'Đang chờ xóa vĩnh viễn hoàn tất'
                        : Date.parse(folder.trash_expires_at) > now
                          ? `Khôi phục trước ${date(Date.parse(folder.trash_expires_at))}`
                          : 'Đã hết hạn khôi phục'}
                    </small>
                    <details className="folder-trash-contents">
                      <summary>Xem nội dung</summary>
                      <ul>
                        {w.folders.items
                          .filter(
                            (item) => item.trash_root_id === folder.id && item.id !== folder.id,
                          )
                          .map((item) => (
                            <li key={item.id}>
                              <Folder size={14} />
                              {item.name}
                            </li>
                          ))}
                        {w.trashFiles
                          .filter((file) => file.trashRootId === folder.id)
                          .map((file) => (
                            <li key={file.id}>
                              <button className="text-button" onClick={() => w.inspect(file.id)}>
                                {file.name}
                              </button>
                            </li>
                          ))}
                      </ul>
                    </details>
                  </div>
                </div>
                <div className="inline-actions">
                  <button
                    className="button secondary"
                    disabled={
                      folder.purging || Date.parse(folder.trash_expires_at) <= now || emptyBusy
                    }
                    onClick={() => setFolderAction({ kind: 'restore', folder })}
                  >
                    <RotateCcw size={15} />
                    Khôi phục
                  </button>
                  <button
                    className="button danger"
                    disabled={emptyBusy}
                    onClick={() => setFolderAction({ kind: 'purge', folder })}
                  >
                    <Trash2 size={15} />
                    Xóa vĩnh viễn
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {w.folders.loading && (
            <p className="muted" role="status">
              Đang đọc thư mục…
            </p>
          )}
        </section>
      )}
      {chosen.length > 0 && (
        <div className="selection-toolbar" aria-label="Thao tác Thùng rác">
          <strong>{chosen.length} tệp đã chọn</strong>
          <button
            disabled={!chosen.every(canRestore)}
            onClick={() =>
              w.requestFileChange(
                'restore',
                chosen.map((file) => file.id),
              )
            }
          >
            <RotateCcw size={16} />
            Khôi phục
          </button>
          <button
            disabled={w.changingFiles}
            onClick={() =>
              w.requestFileChange(
                'purge',
                chosen.map((file) => file.id),
              )
            }
          >
            <Trash2 size={16} />
            Xóa vĩnh viễn
          </button>
          <button onClick={() => setSelected(new Set())}>Bỏ chọn</button>
        </div>
      )}
      {(visible.length > 0 || !shownFolders.length) && (
        <div className="trash-table-scroll">
          <table className="trash-table">
            <colgroup>
              <col className="trash-select-column" />
              <col />
              <col className="trash-size-column" />
              <col className="trash-status-column" />
              <col className="trash-date-column" />
              <col className="trash-expiry-column" />
              <col className="trash-actions-column" />
            </colgroup>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Chọn tất cả tệp Thùng rác trên trang"
                    disabled={!visible.length}
                    checked={Boolean(
                      visible.length && visible.every((file) => selected.has(file.id)),
                    )}
                    onChange={(event) =>
                      setSelected(
                        event.target.checked ? new Set(visible.map((file) => file.id)) : new Set(),
                      )
                    }
                  />
                </th>
                <th>Tên tệp</th>
                <th>Kích thước</th>
                <th>Trạng thái</th>
                <th>Ngày xóa</th>
                <th>Thời hạn khôi phục</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((file) => (
                <tr key={file.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Chọn ${file.name}`}
                      checked={selected.has(file.id)}
                      onChange={() =>
                        setSelected((prior) => {
                          const next = new Set(prior);
                          next.has(file.id) ? next.delete(file.id) : next.add(file.id);
                          return next;
                        })
                      }
                    />
                  </td>
                  <td>
                    <div className="trash-file-name">
                      <FileIcon file={file} />
                      <button
                        className="file-name"
                        title={file.name}
                        onClick={() => w.inspect(file.id)}
                      >
                        {file.name}
                      </button>
                    </div>
                  </td>
                  <td>{formatBytes(file.size)}</td>
                  <td>
                    <ScanBadge {...file} />
                  </td>
                  <td>
                    <time
                      title={file.trashedAt ? new Date(file.trashedAt).toLocaleString('vi-VN') : ''}
                    >
                      {date(file.trashedAt)}
                    </time>
                  </td>
                  <td>
                    {file.lifecycleState === 'deleting'
                      ? 'Đang chờ xóa hoàn tất'
                      : file.trashExpiresAt <= now
                        ? 'Đã hết hạn'
                        : `${Math.ceil((file.trashExpiresAt - now) / 86400000)} ngày · đến ${date(file.trashExpiresAt)}`}
                  </td>
                  <td>
                    <div className="inline-actions">
                      <button
                        className="button secondary"
                        disabled={!canRestore(file)}
                        onClick={() => w.requestFileChange('restore', [file.id])}
                      >
                        <RotateCcw size={15} />
                        Khôi phục
                      </button>
                      <button
                        className="button danger"
                        disabled={!w.canManage(file)}
                        onClick={() => w.requestFileChange('purge', [file.id])}
                      >
                        <Trash2 size={15} />
                        Xóa vĩnh viễn
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!visible.length && !shownFolders.length && (
        <div className="empty-state">
          <Trash2 size={36} />
          <h3>
            {loading ? 'Đang đọc Thùng rác…' : query ? 'Không có tệp phù hợp' : 'Thùng rác trống'}
          </h3>
          <Link to="/files" className="button secondary">
            Về Tệp của tôi
          </Link>
        </div>
      )}
      {all.length > 0 && (
        <div className="trash-pagination">
          <span>
            Trang {currentPage}/{pages}
          </span>
          <button
            className="button secondary"
            disabled={currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}
          >
            Trước
          </button>
          <button
            className="button secondary"
            disabled={currentPage >= pages}
            onClick={() => setPage(currentPage + 1)}
          >
            Sau
          </button>
        </div>
      )}
      {folderAction && (
        <FolderDialogs action={folderAction} onClose={() => setFolderAction(null)} />
      )}
      {emptyDialog && (
        <Modal
          title="Dọn sạch Thùng rác"
          onClose={() => !emptyBusy && setEmptyDialog(false)}
          className="folder-dialog"
        >
          <form onSubmit={emptyTrash}>
            <div className="modal-body">
              <p>
                Xóa vĩnh viễn {folderGroups.length} thư mục cùng nội dung và {all.length} tệp rời
                trong Thùng rác. Thao tác này không thể khôi phục.
              </p>
              {emptyError && (
                <p role="alert" className="banner error">
                  {emptyError}
                </p>
              )}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                disabled={emptyBusy}
                onClick={() => setEmptyDialog(false)}
              >
                Hủy
              </button>
              <button className="button danger" disabled={emptyBusy}>
                {emptyBusy ? 'Đang xóa…' : 'Xóa vĩnh viễn tất cả'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

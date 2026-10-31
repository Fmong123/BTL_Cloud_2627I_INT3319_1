import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, RotateCcw, Search, Trash2 } from 'lucide-react';
import { useWorkspace } from '../state/Workspace.jsx';
import { formatBytes, normalizedSearch } from '../utils/files.js';
import FileIcon from '../components/FileIcon.jsx';
import ScanBadge from '../components/ScanBadge.jsx';
import '../file-workspace.css';

const PAGE_SIZE = 50;
export default function Trash() {
  const w = useWorkspace();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [page, setPage] = useState(1);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setSelected(new Set());
    setPage(1);
  }, [query, w.scope]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const all = [...w.trashFiles].sort((a, b) => b.trashedAt - a.trashedAt);
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
            disabled={!all.length || loading || w.sync.phase === 'error' || w.changingFiles}
            onClick={() =>
              w.requestFileChange(
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
          {filtered.length === all.length ? all.length : `${filtered.length} / ${all.length}`} tệp
        </span>
      </div>
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
      {!visible.length && (
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
    </section>
  );
}

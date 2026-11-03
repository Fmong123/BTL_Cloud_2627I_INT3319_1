import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Info, RefreshCw, Search, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '../auth/Auth.jsx';
import { getFileContent, listQuarantine } from '../api/client.js';
import { formatBytes } from '../utils/files.js';
import { saveFile } from '../utils/saveFile.js';
import FileIcon from '../components/FileIcon.jsx';
import ScanBadge from '../components/ScanBadge.jsx';
import AdminFileDetail from '../components/AdminFileDetail.jsx';
import '../file-workspace.css';
import '../admin-quarantine.css';

const statuses = {
  all: 'Mọi trạng thái',
  flagged: 'Chờ cách ly',
  quarantined: 'Đã cách ly',
  quarantine_delete_failed: 'Chưa xóa được nguồn',
};

export default function AdminQuarantine() {
  const { session } = useAuth();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const owner = params.get('owner') || '';
  const status = Object.hasOwn(statuses, params.get('status')) ? params.get('status') : 'all';
  const [search, setSearch] = useState(query);
  const [state, setState] = useState({
    items: [],
    owners: [],
    cursor: null,
    loading: true,
    error: '',
  });
  const [page, setPage] = useState(null);
  const [revision, refresh] = useState(0);
  const [downloading, setDownloading] = useState(null);
  const [selected, select] = useState(null);
  const [detailRevision, refreshDetail] = useState(0);
  const [downloadError, setDownloadError] = useState('');
  const download = useRef(null);
  const isAdmin = session.user.role === 'admin';
  const filterKey = JSON.stringify([session.baseUrl, owner, status, search]);
  const cursor = page?.key === filterKey ? page.cursor : null;
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 300);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    select(null);
    setDownloadError('');
  }, [filterKey]);
  useEffect(() => {
    if (!isAdmin) return;
    const controller = new AbortController();
    setState((s) => ({
      ...s,
      items: cursor && s.key === filterKey ? s.items : [],
      cursor: null,
      key: filterKey,
      loading: true,
      error: '',
    }));
    listQuarantine(session.baseUrl, {
      cursor,
      ownerId: owner,
      status,
      q: search,
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted)
          setState((s) => ({
            key: filterKey,
            items: cursor
              ? [...s.items, ...result.items].filter(
                  (item, index, all) =>
                    all.findIndex((x) => x.id === item.id && x.owner_id === item.owner_id) ===
                    index,
                )
              : result.items,
            owners: result.owners || [],
            cursor: result.next_cursor,
            loading: false,
            error: '',
          }));
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setState((s) => ({ ...s, loading: false, error: e.message }));
      });
    return () => controller.abort();
  }, [cursor, filterKey, revision, isAdmin]);
  useEffect(() => () => download.current?.abort(), []);
  const update = (name, value) =>
    setParams(
      (prior) => {
        const next = new URLSearchParams(prior);
        if (value && value !== 'all') next.set(name, value);
        else next.delete(name);
        return next;
      },
      { replace: true },
    );

  async function read(item) {
    if (download.current) return;
    const controller = new AbortController();
    download.current = controller;
    setDownloading(item.id);
    setDownloadError('');
    try {
      await saveFile(
        item.display_name || item.original_name,
        () =>
          getFileContent(session.baseUrl, item.id, {
            ownerId: item.owner_id,
            signal: controller.signal,
          }),
        { signal: controller.signal },
      );
    } catch (e) {
      if (!controller.signal.aborted) {
        setState((s) => ({ ...s, error: e.message }));
        setDownloadError(e.message);
      }
    } finally {
      download.current = null;
      if (!controller.signal.aborted) setDownloading(null);
      if (!controller.signal.aborted) refreshDetail((x) => x + 1);
    }
  }

  if (!isAdmin)
    return (
      <section className="empty-state">
        <ShieldAlert size={34} />
        <h2>Bạn không có quyền quản trị</h2>
        <p>Chỉ quản trị viên mới được xem khu vực cách ly.</p>
      </section>
    );
  const items = state.key === filterKey ? state.items : [];
  const filtered = Boolean(query || owner || status !== 'all');
  return (
    <section className="files-section admin-quarantine" aria-label="Quản trị cách ly">
      <div className="files-heading">
        <div>
          <h2>Tệp cần kiểm tra</h2>
          <p>
            Quản lý tệp của các tài khoản trong hệ thống. Mỗi lần tải bản cách ly đều được ghi lịch
            sử.
          </p>
        </div>
        <button
          className="button secondary"
          disabled={state.loading}
          onClick={() => {
            setPage(null);
            refresh((x) => x + 1);
          }}
        >
          <RefreshCw size={16} />
          Làm mới
        </button>
      </div>
      <div className="admin-toolbar">
        <label className="admin-search">
          <Search size={18} />
          <input
            aria-label="Tìm trong quản trị cách ly"
            placeholder="Tìm tên tệp cách ly…"
            value={query}
            maxLength={200}
            onChange={(e) => update('q', e.target.value)}
          />
        </label>
        <select
          aria-label="Lọc chủ sở hữu"
          value={owner}
          onChange={(e) => update('owner', e.target.value)}
        >
          <option value="">Mọi chủ sở hữu</option>
          {state.owners.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Lọc trạng thái cách ly"
          value={status}
          onChange={(e) => update('status', e.target.value)}
        >
          {Object.entries(statuses).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {filtered && (
          <button className="text-button" onClick={() => setParams({}, { replace: true })}>
            <X size={14} />
            Xóa bộ lọc
          </button>
        )}
      </div>
      {state.error && (
        <p className="banner warning admin-feedback" role="alert">
          {state.error}
        </p>
      )}
      <div className="admin-file-list">
        <table>
          <thead>
            <tr>
              <th>Tên tệp</th>
              <th>Chủ sở hữu</th>
              <th>Trạng thái</th>
              <th>Kích thước</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={`${item.owner_id}:${item.id}`}>
                <td>
                  <div className="admin-file-name">
                    <FileIcon file={{ name: item.original_name, type: item.content_type }} />
                    <div>
                      <button
                        className="file-name"
                        onClick={() => {
                          setDownloadError('');
                          select(item);
                        }}
                      >
                        {item.display_name || item.original_name}
                      </button>
                      <small>
                        {item.quarantined_at
                          ? new Date(item.quarantined_at).toLocaleString('vi-VN')
                          : item.scan_status === 'quarantined'
                            ? 'Chưa có thời điểm cách ly'
                            : 'Chưa hoàn tất cách ly'}
                      </small>
                    </div>
                  </div>
                </td>
                <td className="admin-owner">{item.owner_name}</td>
                <td>
                  <ScanBadge scanStatus={item.scan_status} statusReason={item.status_reason} />
                </td>
                <td>{formatBytes(item.size_bytes)}</td>
                <td>
                  <div className="inline-actions">
                    <button
                      className="button secondary"
                      onClick={() => {
                        setDownloadError('');
                        select(item);
                      }}
                    >
                      <Info size={15} />
                      Chi tiết
                    </button>
                    <button
                      className="button secondary"
                      disabled={!item.can_read || Boolean(downloading)}
                      onClick={() => read(item)}
                    >
                      <Download size={15} />
                      {downloading === item.id ? 'Đang đọc…' : 'Tải bản cách ly'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!state.loading && !state.error && !items.length && (
        <div className="empty-state">
          <ShieldCheck size={36} />
          <h3>
            {state.cursor
              ? 'Chưa thấy tệp trong lượt tải này'
              : filtered
                ? 'Không có tệp phù hợp'
                : 'Chưa có tệp cách ly'}
          </h3>
          <p>
            {state.cursor
              ? 'Còn dữ liệu chưa đọc. Chọn Xem thêm để tiếp tục.'
              : filtered
                ? 'Thử đổi từ khóa hoặc bộ lọc.'
                : 'Các tệp cần kiểm tra sẽ xuất hiện tại đây.'}
          </p>
        </div>
      )}
      <div className="admin-pagination">
        <span role="status">
          {state.loading
            ? 'Đang đọc danh sách cách ly…'
            : `Đã tải ${items.length} tệp${state.cursor ? ' · Còn dữ liệu' : ''}`}
        </span>
        {state.cursor && (
          <button
            className="button secondary"
            disabled={state.loading}
            onClick={() => setPage({ key: filterKey, cursor: state.cursor })}
          >
            Xem thêm
          </button>
        )}
      </div>
      {selected && (
        <AdminFileDetail
          key={`${selected.owner_id}:${selected.id}`}
          item={selected}
          baseUrl={session.baseUrl}
          onClose={() => select(null)}
          onDownload={read}
          downloading={Boolean(downloading)}
          revision={detailRevision}
          downloadError={downloadError}
        />
      )}
    </section>
  );
}

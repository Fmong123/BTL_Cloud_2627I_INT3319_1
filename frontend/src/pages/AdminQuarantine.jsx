import { useEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Info, RefreshCw, Search, ShieldAlert, ShieldCheck, X } from 'lucide-react';
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
  const location = useLocation();
  const query = params.get('q') || '';
  const owner = params.get('owner') || '';
  const linkedFile = params.get('file');
  const status = Object.hasOwn(statuses, params.get('status')) ? params.get('status') : 'all';
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  const invalidDate = [from, to].filter(Boolean).some((value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return true;
    const date = new Date(value + 'T00:00:00');
    const [year, month, day] = value.split('-').map(Number);
    return (
      !Number.isFinite(date.getTime()) ||
      date.getFullYear() !== year ||
      date.getMonth() + 1 !== month ||
      date.getDate() !== day
    );
  });
  const dateError = invalidDate || Boolean(from && to && from > to);
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
  const filterKey = JSON.stringify([session.baseUrl, owner, status, search, from, to]);
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
    if (dateError) {
      setState((s) => ({
        ...s,
        key: filterKey,
        items: [],
        cursor: null,
        loading: false,
        error: invalidDate
          ? 'Ngày lọc chưa hợp lệ. Hãy chọn lại ngày.'
          : 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.',
      }));
      return;
    }
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
      updatedFrom: from ? new Date(from + 'T00:00:00').toISOString() : undefined,
      updatedBefore: to
        ? (() => {
            const end = new Date(to + 'T00:00:00');
            end.setDate(end.getDate() + 1);
            return end.toISOString();
          })()
        : undefined,
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
  const detail =
    owner && linkedFile
      ? (items.find((item) => item.id === linkedFile && item.owner_id === owner) ?? {
          id: linkedFile,
          owner_id: owner,
        })
      : selected;
  const filtered = Boolean(query || owner || status !== 'all' || from || to);
  return (
    <section className="files-section admin-quarantine" aria-label="Quản trị cách ly">
      <div className="files-heading">
        <div>
          <h2>Tệp cần kiểm tra</h2>
          <p>
            Quản lý tệp của người dùng trong phạm vi quản trị. Mỗi lần tải bản cách ly đều được ghi lịch
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
      <div className="admin-status-tabs" role="group" aria-label="Trạng thái cách ly">
        {Object.entries({ ...statuses, quarantine_delete_failed: 'Cách ly lỗi' }).map(
          ([value, label]) => (
            <button
              className={status === value ? 'active' : ''}
              aria-pressed={status === value}
              key={value}
              onClick={() => update('status', value)}
            >
              {value === 'all' ? 'Tất cả' : label}
            </button>
          ),
        )}
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
          className="admin-filter-select"
          aria-label="Lọc chủ sở hữu"
          value={owner}
          onChange={(e) => update('owner', e.target.value)}
        >
          <option value="">Tất cả người dùng</option>
          {state.owners.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
        <label className="admin-date-filter">
          Cập nhật từ
          <input
            type="date"
            aria-label="Cập nhật từ ngày"
            value={from}
            onChange={(e) => update('from', e.target.value)}
          />
        </label>
        <label className="admin-date-filter">
          Đến ngày
          <input
            type="date"
            aria-label="Cập nhật đến ngày"
            value={to}
            onChange={(e) => update('to', e.target.value)}
          />
        </label>
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
        <table className="file-table processing-table">
          <colgroup>
            <col className="admin-name-col" />
            <col className="admin-owner-col" />
            <col className="admin-status-col" />
            <col className="admin-findings-col" />
            <col className="admin-updated-col" />
            <col className="admin-actions-col" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">
                <span className="admin-name-heading">Tên tệp</span>
              </th>
              <th scope="col" className="metadata-column">
                Chủ sở hữu
              </th>
              <th scope="col" className="metadata-column">
                Trạng thái
              </th>
              <th scope="col" className="metadata-column">
                Phát hiện
              </th>
              <th scope="col" className="metadata-column">
                Cập nhật
              </th>
              <th scope="col" className="metadata-column">
                Thao tác
              </th>
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
                        title={item.display_name || item.original_name}
                        onClick={() => {
                          setDownloadError('');
                          select(item);
                        }}
                      >
                        {item.display_name || item.original_name}
                      </button>
                      <small>
                        {formatBytes(item.size_bytes)} ·{' '}
                        {item.quarantined_at
                          ? new Date(item.quarantined_at).toLocaleString('vi-VN')
                          : item.scan_status === 'quarantined'
                            ? 'Chưa có thời điểm cách ly'
                            : 'Chưa hoàn tất cách ly'}
                      </small>
                    </div>
                  </div>
                </td>
                <td
                  className="admin-owner metadata-column"
                  data-label="Chủ sở hữu"
                  title={item.owner_name}
                >
                  {item.owner_name}
                </td>
                <td className="metadata-column" data-label="Trạng thái">
                  <ScanBadge scanStatus={item.scan_status} statusReason={item.status_reason} />
                </td>
                <td className="metadata-column" data-label="Phát hiện">
                  {item.findings_count ?? '—'}
                  <small>
                    {(item.finding_types || [])
                      .map(
                        (type) => ({ CCCD_VN: 'CCCD', CREDIT_CARD: 'Thẻ ngân hàng' })[type] || type,
                      )
                      .join(', ') || 'Chưa có thống kê'}
                  </small>
                </td>
                <td className="metadata-column" data-label="Cập nhật">
                  <time className="cell-date" dateTime={item.updated_at}>
                    {new Date(item.updated_at).toLocaleDateString('vi-VN')}
                  </time>
                  <span className="cell-time">
                    {new Date(item.updated_at).toLocaleTimeString('vi-VN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </td>
                <td className="metadata-column">
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
      {detail && (
        <AdminFileDetail
          key={`${detail.owner_id}:${detail.id}`}
          item={detail}
          baseUrl={session.baseUrl}
          focusReview={Boolean(linkedFile && location.state?.focusReview)}
          onReviewSaved={() => refresh((value) => value + 1)}
          onClose={() => {
            select(null);
            setDownloadError('');
            if (linkedFile) update('file', null);
          }}
          onDownload={read}
          downloading={Boolean(downloading)}
          revision={detailRevision}
          downloadError={downloadError}
        />
      )}
    </section>
  );
}

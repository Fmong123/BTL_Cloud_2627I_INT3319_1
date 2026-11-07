import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  CircleAlert,
  Clock3,
  History,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import { useAuth } from '../auth/Auth.jsx';
import { getAdminHistory, getAdminHistoryEvent } from '../api/client.js';
import AdminDate from '../components/AdminDate.jsx';
import { formatStorageUsage as size } from '../utils/storageUsage.js';
import '../admin-management.css';
import '../admin-history.css';

const categories = {
  all: 'Mọi thao tác',
  account: 'Tài khoản & quota',
  billing: 'Chi phí & chính sách',
  pipeline: 'Xử lý tệp',
  report: 'Xuất dữ liệu',
  trash: 'Dọn Thùng rác',
};
const outcomes = {
  all: 'Mọi kết quả',
  success: 'Thành công',
  failed: 'Thất bại',
  pending: 'Đã ghi nhận yêu cầu',
  unknown: 'Chưa xác nhận',
  closed: 'Đã kết thúc',
};
function defaults(owner = '') {
  const end = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const start = new Date(Date.parse(`${end}T00:00:00Z`) - 6 * 86400_000).toISOString().slice(0, 10);
  return {
    from_date: start,
    to_date: end,
    owner_id: owner,
    category: 'all',
    outcome: 'all',
    q: '',
  };
}
function Result({ event }) {
  const Icon =
    event.outcome === 'success' ? Check : event.outcome === 'failed' ? CircleAlert : Clock3;
  return (
    <span className={`admin-tag history-result ${event.outcome}`}>
      <Icon size={14} />
      {event.outcome_label}
    </span>
  );
}
function value(change, side) {
  const result = change[side];
  if (result == null) return 'Chưa ghi nhận';
  return change.format === 'bytes'
    ? size(result)
    : change.format === 'vnd'
      ? `${Number(result).toLocaleString('vi-VN')} đ`
      : String(result);
}

export default function AdminHistory() {
  const { session } = useAuth();
  const [params, setParams] = useSearchParams();
  const owner = params.get('owner_id') || '';
  const [draft, setDraft] = useState(() => defaults(owner));
  const [filters, setFilters] = useState(draft);
  const [cursor, setCursor] = useState(null);
  const [previous, setPrevious] = useState([]);
  const [revision, refresh] = useState(0);
  const [state, setState] = useState({ loading: true });
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailRevision, refreshDetail] = useState(0);
  const detailHeading = useRef(null);
  useEffect(() => {
    setDraft((prior) => ({ ...prior, owner_id: owner }));
    setFilters((prior) => (prior.owner_id === owner ? prior : { ...prior, owner_id: owner }));
    setCursor(null);
    setPrevious([]);
    setSelected(null);
  }, [owner]);
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true });
    setSelected(null);
    const query = Object.fromEntries(
      Object.entries({ ...filters, cursor, limit: '20' }).filter(([, v]) => v != null && v !== ''),
    );
    getAdminHistory(session.baseUrl, query, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setState({ data });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setState({ error: error.message });
      });
    return () => controller.abort();
  }, [session.baseUrl, filters, cursor, revision]);
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    setDetail({ loading: true });
    getAdminHistoryEvent(session.baseUrl, selected, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setDetail({ data });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setDetail({ error: error.message });
      });
    return () => controller.abort();
  }, [session.baseUrl, selected, detailRevision]);
  useEffect(() => {
    if (detail?.data) detailHeading.current?.focus();
  }, [detail?.data]);
  function apply(next) {
    setDraft({ ...next });
    setFilters({ ...next });
    setCursor(null);
    setPrevious([]);
    setSelected(null);
    setParams(next.owner_id ? { owner_id: next.owner_id } : {}, { replace: true });
  }
  function reload() {
    setCursor(null);
    setPrevious([]);
    refresh((v) => v + 1);
  }
  const data = state.data;
  const event = detail?.data;
  return (
    <section className="admin-management admin-history-page" aria-label="Lịch sử quản trị">
      <section className="files-section admin-panel history-panel">
        <div className="admin-panel-heading">
          <div>
            <h2>Lịch sử quản trị</h2>
            <p>Tra cứu thao tác, thay đổi và kết quả xử lý đã được ghi nhận.</p>
          </div>
          <div className="admin-row-actions">
            <span className="admin-tag role">
              <LockKeyhole size={14} />
              Chỉ đọc
            </span>
            <button className="button secondary" disabled={state.loading} onClick={reload}>
              <RefreshCw size={16} />
              Làm mới
            </button>
          </div>
        </div>
        <form
          className="admin-filters history-filters"
          onSubmit={(e) => {
            e.preventDefault();
            apply(draft);
          }}
        >
          <label className="history-search">
            Tìm kiếm
            <span>
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                maxLength={200}
                placeholder="Tài khoản, tên tệp hoặc thao tác…"
                value={draft.q}
                onChange={(e) => setDraft({ ...draft, q: e.target.value })}
              />
            </span>
          </label>
          <label>
            Tài khoản
            <select
              aria-label="Tài khoản"
              value={draft.owner_id}
              onChange={(e) => setDraft({ ...draft, owner_id: e.target.value })}
            >
              <option value="">Mọi người dùng</option>
              {data?.owners.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
              {draft.owner_id && !data?.owners.some((item) => item.id === draft.owner_id) && (
                <option value={draft.owner_id}>Tài khoản đã chọn</option>
              )}
            </select>
          </label>
          <label>
            Loại thao tác
            <select
              aria-label="Loại thao tác"
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            >
              {Object.entries(categories).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Kết quả
            <select
              aria-label="Kết quả"
              value={draft.outcome}
              onChange={(e) => setDraft({ ...draft, outcome: e.target.value })}
            >
              {Object.entries(outcomes).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Từ ngày
            <input
              type="date"
              required
              max={draft.to_date}
              value={draft.from_date}
              onChange={(e) => setDraft({ ...draft, from_date: e.target.value })}
            />
          </label>
          <label>
            Đến ngày
            <input
              type="date"
              required
              min={draft.from_date}
              value={draft.to_date}
              onChange={(e) => setDraft({ ...draft, to_date: e.target.value })}
            />
          </label>
          <div className="admin-row-actions history-filter-actions">
            <button className="button primary" disabled={state.loading}>
              Áp dụng
            </button>
            <button type="button" className="button secondary" onClick={() => apply(defaults())}>
              <RotateCcw size={16} />
              Đặt lại
            </button>
          </div>
        </form>
        {state.loading ? (
          <p className="admin-empty" role="status">
            Đang đọc lịch sử quản trị…
          </p>
        ) : state.error ? (
          <div className="history-error">
            <p className="banner warning" role="alert">
              {state.error}
            </p>
            <button className="button secondary" onClick={reload}>
              Thử lại từ đầu
            </button>
          </div>
        ) : (
          data && (
            <>
              <div className="history-list-heading">
                <h3>
                  Danh sách sự kiện{' '}
                  <span className="count-badge">{data.total.toLocaleString('vi-VN')}</span>
                </h3>
                <p>Tài khoản người dùng · Báo cáo do bạn xuất</p>
              </div>
              {data.items.length ? (
                <div className="admin-table-scroll history-table-wrap">
                  <table className="admin-table history-table">
                    <thead>
                      <tr>
                        <th className="history-center">Thời gian</th>
                        <th>Người thực hiện</th>
                        <th>Thao tác</th>
                        <th>Đối tượng</th>
                        <th className="history-center">Kết quả</th>
                        <th className="history-center">Chi tiết</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((row) => (
                        <tr key={row.id} className={selected === row.id ? 'history-selected' : ''}>
                          <td className="history-center" data-label="Thời gian">
                            <AdminDate value={row.occurred_at} />
                          </td>
                          <td data-label="Người thực hiện">
                            <strong>{row.actor_name}</strong>
                            <small>
                              {row.actor_kind === 'system'
                                ? 'Tự động'
                                : row.actor_kind === 'user'
                                  ? 'Người dùng'
                                  : 'Quản trị viên'}
                            </small>
                          </td>
                          <td data-label="Thao tác">
                            <strong>{row.action_label}</strong>
                            <small>{row.category_label}</small>
                          </td>
                          <td data-label="Đối tượng">
                            <strong>{row.owner_name}</strong>
                            <small>{row.target_name}</small>
                          </td>
                          <td className="history-center" data-label="Kết quả">
                            <Result event={row} />
                          </td>
                          <td className="history-center history-view">
                            <button
                              className="button secondary"
                              aria-label={`Xem ${row.action_label}`}
                              aria-pressed={selected === row.id}
                              aria-controls="admin-history-detail"
                              onClick={() => setSelected(row.id)}
                            >
                              Xem
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="admin-empty">Không có sự kiện phù hợp với bộ lọc.</p>
              )}
              <div className="admin-pagination">
                <span>{data.items.length} sự kiện trên trang này · Múi giờ Việt Nam</span>
                <div className="admin-row-actions">
                  {previous.length > 0 && (
                    <button
                      className="button secondary"
                      onClick={() => {
                        setCursor(previous.at(-1));
                        setPrevious((p) => p.slice(0, -1));
                      }}
                    >
                      Trang trước
                    </button>
                  )}
                  {data.next_cursor && (
                    <button
                      className="button secondary"
                      onClick={() => {
                        setPrevious((p) => [...p, cursor]);
                        setCursor(data.next_cursor);
                      }}
                    >
                      Trang tiếp
                    </button>
                  )}
                </div>
              </div>
            </>
          )
        )}
      </section>
      {selected && (
        <section
          className="files-section admin-panel history-detail"
          id="admin-history-detail"
          aria-label="Chi tiết sự kiện"
        >
          <div className="admin-panel-heading">
            <h2 ref={detailHeading} tabIndex={-1}>
              <History size={20} />
              Chi tiết sự kiện
            </h2>
            <button
              className="icon-button admin-action-box"
              aria-label="Đóng chi tiết"
              onClick={() => setSelected(null)}
            >
              <X size={18} />
            </button>
          </div>
          {detail?.loading && (
            <p className="admin-empty" role="status">
              Đang đọc chi tiết…
            </p>
          )}
          {detail?.error && (
            <div className="history-error">
              <p className="banner warning" role="alert">
                {detail.error}
              </p>
              <button className="button secondary" onClick={() => refreshDetail((v) => v + 1)}>
                Thử lại
              </button>
            </div>
          )}
          {event && (
            <div className="history-detail-body">
              <div className="history-detail-title">
                <h3>{event.action_label}</h3>
                <Result event={event} />
              </div>
              <dl className="history-facts">
                <div>
                  <dt>Người thực hiện</dt>
                  <dd>{event.actor_name}</dd>
                </div>
                <div>
                  <dt>Thời gian</dt>
                  <dd>
                    <AdminDate value={event.occurred_at} inline />
                  </dd>
                </div>
                <div>
                  <dt>Tài khoản chịu tác động</dt>
                  <dd>
                    {event.owner_name}
                    {event.owner_email && event.owner_email !== event.owner_name && (
                      <small>{event.owner_email}</small>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Đối tượng</dt>
                  <dd>{event.target_name}</dd>
                </div>
              </dl>
              {event.changes.map((change) => (
                <div className="history-change" key={change.label}>
                  <h4>{change.label}</h4>
                  <div>
                    <span>Trước thay đổi</span>
                    <strong>{value(change, 'before')}</strong>
                  </div>
                  <ArrowRight size={18} aria-hidden="true" />
                  <div>
                    <span>Sau thay đổi</span>
                    <strong>{value(change, 'after')}</strong>
                  </div>
                </div>
              ))}
              {event.facts.length > 0 && (
                <dl className="history-facts">
                  {event.facts.map((fact) => (
                    <div key={fact.label}>
                      <dt>{fact.label}</dt>
                      <dd>{String(fact.value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <div className="history-reason">
                <h4>Lý do</h4>
                <p>{event.reason || 'Sự kiện này chưa ghi nhận lý do riêng.'}</p>
              </div>
              {event.note && <p className="banner">{event.note}</p>}
              <div className="admin-row-actions history-detail-links">
                {event.owner_id && (
                  <Link
                    className="button secondary"
                    to={`/admin/accounts?owner_id=${event.owner_id}`}
                  >
                    Xem tài khoản
                    <ArrowRight size={15} />
                  </Link>
                )}
                {event.owner_id && event.category === 'pipeline' && (
                  <Link
                    className="button secondary"
                    to={`/admin/quarantine?owner_id=${event.owner_id}`}
                  >
                    Mở quản trị cách ly
                    <ArrowRight size={15} />
                  </Link>
                )}
              </div>
            </div>
          )}
        </section>
      )}
    </section>
  );
}

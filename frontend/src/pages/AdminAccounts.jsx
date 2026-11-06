import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  RefreshCw,
  Settings2,
  History,
  UsersRound,
  UserRound,
  UserX,
  Check,
  LockKeyhole,
  Clock3,
  ChartNoAxesCombined,
  RotateCcw,
  UserCheck,
} from 'lucide-react';
import { useAuth } from '../auth/Auth.jsx';
import { getAdminAccounts, getAdminAccountHistory, updateAdminAccount } from '../api/client.js';
import { formatStorageUsage as size } from '../utils/storageUsage.js';
import Modal from '../components/Modal.jsx';
import AccountSearch from '../components/AccountSearch.jsx';
import AdminDate from '../components/AdminDate.jsx';
import '../admin-management.css';

const roles = { admin: 'Quản trị viên', user: 'Người dùng' };

function AccountEditor({ item, baseUrl, onClose, onSaved }) {
  const [kind, setKind] = useState(item.pending ? 'access' : 'quota');
  const [limit, setLimit] = useState(String(item.quota.limit_bytes / 1_000_000));
  const [enabled, setEnabled] = useState(item.pending?.enabled ?? item.enabled);
  const [reason, setReason] = useState(item.pending?.reason || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(null);
  const minimum = item.quota.used_bytes + item.quota.reserved_bytes;
  async function submit(event) {
    event.preventDefault();
    const bytes = Math.round(Number(limit) * 1_000_000);
    if (kind === 'quota' && (!Number.isSafeInteger(bytes) || bytes < minimum)) {
      setError(
        `Hạn mức tối thiểu là ${minimum.toLocaleString('vi-VN')} byte (đã dùng + đang giữ chỗ).`,
      );
      return;
    }
    const body =
      kind === 'quota'
        ? { limit_bytes: bytes, revision: item.quota_revision, reason: reason.trim() }
        : { role: 'user', enabled, revision: item.revision, reason: reason.trim() };
    const signature = JSON.stringify(body);
    const requestId =
      item.pending?.request_id ||
      (attempt?.signature === signature ? attempt.id : crypto.randomUUID());
    setAttempt({ signature, id: requestId });
    setBusy(true);
    setError('');
    try {
      await updateAdminAccount(baseUrl, item.id, kind, { ...body, request_id: requestId });
      if (kind === 'quota') window.dispatchEvent(new Event('maysec:quota-changed'));
      onSaved(
        kind === 'quota'
          ? 'Đã cập nhật hạn mức dung lượng.'
          : 'Đã cập nhật trạng thái truy cập tài khoản.',
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`Quản lý · ${item.name}`}
      onClose={() => !busy && onClose()}
      className="admin-edit-modal"
    >
      <form className="admin-edit-form" onSubmit={submit}>
        <p className="admin-muted">{item.email || item.username}</p>
        {error && (
          <p className="banner warning" role="alert">
            {error}
          </p>
        )}
        {item.pending && (
          <p className="banner warning">
            Thay đổi trước chưa được xác nhận đầy đủ. Tiếp tục đồng bộ sẽ đối chiếu và hoàn tất đúng
            yêu cầu đang chờ. Tài khoản tạm bị chặn truy cập trong lúc chờ.
          </p>
        )}
        <label>
          Thiết lập
          <select
            value={kind}
            disabled={busy || Boolean(item.pending)}
            onChange={(e) => {
              setKind(e.target.value);
              setError('');
            }}
          >
            <option value="quota">Hạn mức dung lượng</option>
            <option value="access">Trạng thái truy cập</option>
          </select>
        </label>
        {kind === 'quota' ? (
          <>
            <div className="admin-quota-detail">
              <span>
                Đã dùng <strong>{size(item.quota.used_bytes)}</strong>
              </span>
              <span>
                Đang giữ chỗ <strong>{size(item.quota.reserved_bytes)}</strong>
              </span>
            </div>
            <label>
              Hạn mức mới (MB)
              <input
                type="number"
                min="0"
                max="10000000"
                step="0.000001"
                required
                value={limit}
                disabled={busy}
                onChange={(e) => setLimit(e.target.value)}
              />
            </label>
            <p className="admin-muted">
              1.000 MB = 1 GB. Không được thấp hơn tổng đã dùng và đang giữ chỗ:{' '}
              {minimum.toLocaleString('vi-VN')} byte. Tệp trong Thùng rác vẫn tính vào dung lượng.
            </p>
          </>
        ) : (
          <>
            <div className="account-role-note">
              <span className="admin-tag role">
                <UserRound size={14} />
                Người dùng
              </span>
            </div>
            <label>
              Trạng thái truy cập
              <select
                value={String(enabled)}
                disabled={busy || Boolean(item.pending)}
                onChange={(e) => setEnabled(e.target.value === 'true')}
              >
                <option value="true">Cho phép đăng nhập</option>
                <option value="false">Tạm khóa</option>
              </select>
            </label>
            <p className="admin-muted">
              Thay đổi áp dụng cho quyền truy cập ứng dụng và tài khoản Cognito. Mở khóa vẫn cần tài
              khoản hoàn tất bước xác nhận đăng nhập.
            </p>
          </>
        )}
        <label>
          Lý do thay đổi
          <textarea
            minLength={3}
            maxLength={300}
            required
            value={reason}
            disabled={busy || Boolean(item.pending)}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            Hủy
          </button>
          <button className="button primary" disabled={busy || reason.trim().length < 3}>
            {busy ? 'Đang đồng bộ…' : item.pending ? 'Tiếp tục đồng bộ' : 'Lưu thay đổi'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const actions = {
  account_quota_changed: 'Đổi hạn mức dung lượng',
  account_access_requested: 'Yêu cầu đổi quyền truy cập',
  account_access_changed: 'Đã đổi quyền truy cập',
  admin_report_exported: 'Xuất báo cáo quản trị',
};
function AccountHistory({ item, baseUrl, onClose }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    const controller = new AbortController();
    getAdminAccountHistory(baseUrl, item.id, { signal: controller.signal })
      .then((data) => setState(data))
      .catch((e) => {
        if (!controller.signal.aborted) setState({ error: e.message });
      });
    return () => controller.abort();
  }, [baseUrl, item.id]);
  return (
    <Modal title={`Nhật ký · ${item.name}`} onClose={onClose} wide>
      <div className="admin-history">
        {state.loading && <p role="status">Đang đọc nhật ký…</p>}
        {state.error && (
          <p className="banner warning" role="alert">
            {state.error}
          </p>
        )}
        {state.items?.length === 0 && <p>Chưa có thay đổi quản trị.</p>}
        {state.items?.map((event) => (
          <article key={event.event_key}>
            <strong>{actions[event.action] || event.action}</strong>
            <p>
              <AdminDate value={event.occurred_at} inline />
            </p>
            {event.details?.before_bytes != null && (
              <p>
                {size(event.details.before_bytes)} → {size(event.details.after_bytes)}
              </p>
            )}
            {event.details?.role && (
              <p>
                {roles[event.details.role]} ·{' '}
                {event.details.enabled ? 'Cho phép đăng nhập' : 'Tạm khóa'}
              </p>
            )}
            {event.details?.format && (
              <p>
                Định dạng {event.details.format.toUpperCase()} · {event.details.files} tệp
              </p>
            )}
            {event.details?.reason && <p>Lý do: {event.details.reason}</p>}
            <p className="admin-muted admin-id">Người thực hiện: {event.actor}</p>
          </article>
        ))}
        <p className="admin-muted">{state.note}</p>
      </div>
    </Modal>
  );
}

export default function AdminAccounts() {
  const { session } = useAuth();
  const [draft, setDraft] = useState({ q: '', state: 'all', owner_id: '' });
  const [filters, setFilters] = useState(draft);
  const [cursor, setCursor] = useState(null);
  const [revision, refresh] = useState(0);
  const [state, setState] = useState({ loading: true });
  const [edit, setEdit] = useState(null);
  const [history, setHistory] = useState(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true });
    getAdminAccounts(session.baseUrl, { ...filters, cursor }, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setState(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setState({ error: e.message });
      });
    return () => controller.abort();
  }, [session.baseUrl, filters, cursor, revision]);
  const reload = () => {
    setCursor(null);
    refresh((x) => x + 1);
  };
  return (
    <section className="admin-management" aria-label="Quản trị tài khoản">
      <div className="admin-summary">
        {[
          [UsersRound, 'Tài khoản người dùng', state.accounts_total],
          [UserCheck, 'Đang hoạt động', state.active_total],
          [UserX, 'Chưa hoạt động / tạm khóa', state.inactive_total],
        ].map(([Icon, label, value]) => (
          <div className="admin-metric" key={label}>
            <span>
              <Icon size={19} />
              {label}
            </span>
            <strong>{value ?? '—'}</strong>
          </div>
        ))}
      </div>
      <section className="files-section admin-panel accounts-panel">
        <div className="admin-panel-heading">
          <div>
            <h2>Danh sách tài khoản</h2>
            <p>
              Quản lý trạng thái và dung lượng của người dùng. Tài khoản quản trị không nằm trong
              danh sách này.
            </p>
          </div>
          <button className="button secondary" onClick={reload} disabled={state.loading}>
            <RefreshCw size={16} />
            Làm mới
          </button>
        </div>
        <form
          className="admin-filters"
          onSubmit={(e) => {
            e.preventDefault();
            setFilters({ ...draft });
            setCursor(null);
          }}
        >
          <AccountSearch
            baseUrl={session.baseUrl}
            value={draft.q}
            onChange={(q) => setDraft({ ...draft, q, owner_id: '' })}
            onSelect={(item) => {
              const next = { ...draft, q: item.name, owner_id: item.id };
              setDraft(next);
              setFilters(next);
              setCursor(null);
            }}
          />
          <label>
            Trạng thái
            <select
              value={draft.state}
              onChange={(e) => setDraft({ ...draft, state: e.target.value })}
            >
              <option value="all">Mọi trạng thái</option>
              <option value="active">Đang hoạt động</option>
              <option value="inactive">Chưa hoạt động / tạm khóa</option>
            </select>
          </label>
          <button className="button secondary" disabled={state.loading}>
            Áp dụng
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={state.loading}
            onClick={() => {
              const next = { q: '', state: 'all', owner_id: '' };
              setDraft(next);
              setFilters(next);
              setCursor(null);
            }}
          >
            <RotateCcw size={16} />
            Đặt lại
          </button>
        </form>
        {message && (
          <p className="banner" role="status">
            {message}
          </p>
        )}
        {state.error && (
          <p className="banner warning" role="alert">
            {state.error}
            <button className="button secondary" onClick={reload}>
              Tải lại từ đầu
            </button>
          </p>
        )}
        {state.loading ? (
          <p className="admin-empty" role="status">
            Đang đọc tài khoản và dung lượng…
          </p>
        ) : (
          state.items && (
            <>
              <div className="admin-table-scroll">
                <table className="admin-table accounts-table">
                  <colgroup>
                    {['19%', '12.5%', '15%', '19%', '14.5%', '20%'].map((width, i) => (
                      <col key={i} style={{ width }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Tài khoản</th>
                      <th>Vai trò</th>
                      <th>Trạng thái</th>
                      <th>Dung lượng</th>
                      <th className="account-date-cell">Đăng nhập gần nhất</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <div className="account-identity">
                            <strong title={item.name}>{item.name}</strong>
                            {item.email && item.email !== item.name && <span>{item.email}</span>}
                            <small className="admin-id" title={item.id}>
                              {item.id}
                            </small>
                          </div>
                        </td>
                        <td>
                          <span className="admin-tag role">
                            <UserRound size={13} />
                            Người dùng
                          </span>
                        </td>
                        <td>
                          <div className="account-status-stack">
                            <span
                              className={`admin-tag ${item.active && !item.pending ? 'positive' : item.enabled ? 'caution' : ''}`}
                            >
                              {item.active && !item.pending ? (
                                <Check size={13} />
                              ) : item.enabled ? (
                                <Clock3 size={13} />
                              ) : (
                                <LockKeyhole size={13} />
                              )}
                              {item.pending
                                ? 'Chờ đồng bộ'
                                : item.enabled
                                  ? item.active
                                    ? 'Đang hoạt động'
                                    : 'Chưa sẵn sàng'
                                  : 'Tạm khóa'}
                            </span>
                          </div>
                        </td>
                        <td>
                          <strong>
                            {size(item.quota.used_bytes)} / {size(item.quota.limit_bytes)}
                          </strong>
                          <progress
                            aria-label={`Dung lượng ${item.name}`}
                            max={Math.max(1, item.quota.limit_bytes)}
                            value={Math.min(
                              item.quota.used_bytes + item.quota.reserved_bytes,
                              Math.max(1, item.quota.limit_bytes),
                            )}
                          />
                          <span>
                            Giữ chỗ {size(item.quota.reserved_bytes)} · Còn{' '}
                            {size(item.quota.available_bytes)}
                          </span>
                        </td>
                        <td className="account-date-cell">
                          <AdminDate value={item.last_login_at} />
                        </td>
                        <td>
                          <div className="admin-row-actions">
                            <button className="button secondary" onClick={() => setEdit(item)}>
                              <Settings2 size={15} />
                              Quản lý
                            </button>
                            <button
                              className="icon-button admin-action-box"
                              title="Nhật ký"
                              aria-label={`Nhật ký ${item.name}`}
                              onClick={() => setHistory(item)}
                            >
                              <History size={18} />
                            </button>
                            <Link
                              className="icon-button admin-action-box"
                              title="Thống kê"
                              aria-label={`Thống kê ${item.name}`}
                              to={`/admin/reports?owner_id=${item.id}`}
                            >
                              <ChartNoAxesCombined size={18} />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!state.items.length && <p className="admin-empty">Không có tài khoản phù hợp.</p>}
              </div>
              <div className="admin-pagination">
                <span>
                  {state.total} tài khoản phù hợp · {state.items.length} trên trang này
                </span>
                <div className="admin-row-actions">
                  {cursor && (
                    <button className="button secondary" onClick={() => setCursor(null)}>
                      Về đầu
                    </button>
                  )}
                  {state.next_cursor && (
                    <button
                      className="button secondary"
                      onClick={() => setCursor(state.next_cursor)}
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
      {edit && (
        <AccountEditor
          item={edit}
          baseUrl={session.baseUrl}
          onClose={() => {
            setEdit(null);
            reload();
          }}
          onSaved={(text) => {
            setEdit(null);
            setMessage(text);
            reload();
          }}
        />
      )}
      {history && (
        <AccountHistory item={history} baseUrl={session.baseUrl} onClose={() => setHistory(null)} />
      )}
    </section>
  );
}

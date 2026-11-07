import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Download,
  RefreshCw,
  RotateCcw,
  Files,
  ShieldAlert,
  CircleAlert,
  Clock3,
  ArrowRight,
  UsersRound,
} from 'lucide-react';
import { useAuth } from '../auth/Auth.jsx';
import { downloadAdminReport, getAdminReport, getAdminReportOwners } from '../api/client.js';
import { formatStorageUsage as size } from '../utils/storageUsage.js';
import AdminDate, { reportDate } from '../components/AdminDate.jsx';
import '../admin-management.css';

const n = (value) => Number(value).toLocaleString('vi-VN');
function recent(days) {
  const end = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const start = new Date(Date.parse(`${end}T00:00:00Z`) - (days - 1) * 86400_000)
    .toISOString()
    .slice(0, 10);
  return { from_date: start, to_date: end };
}
function DataTable({
  headers,
  rows,
  numeric = [],
  widths = [],
  className = '',
  empty = 'Không có dữ liệu trong phạm vi đã chọn.',
}) {
  return rows.length ? (
    <div className="admin-table-scroll">
      <table className={`admin-table ${headers.length > 3 ? 'admin-wide-table' : ''} ${className}`}>
        {widths.length > 0 && (
          <colgroup>
            {widths.map((width, i) => (
              <col key={i} style={{ width }} />
            ))}
          </colgroup>
        )}
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={h} className={numeric.includes(i) ? 'admin-numeric' : undefined}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className={numeric.includes(j) ? 'admin-numeric' : undefined}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <p className="admin-empty">{empty}</p>
  );
}

export default function AdminReports() {
  const { session } = useAuth();
  const [params, setParams] = useSearchParams();
  const owner = params.get('owner_id') || '';
  const [draft, setDraft] = useState(() => ({ ...recent(30), owner_id: owner, lifecycle: 'all' }));
  const [filters, setFilters] = useState(draft);
  const [revision, refresh] = useState(0);
  const [state, setState] = useState({ loading: true });
  const [owners, setOwners] = useState([]);
  const [exporting, setExporting] = useState('');
  const [feedback, setFeedback] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    getAdminReportOwners(session.baseUrl, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setOwners(data.items);
      })
      .catch(() => {
        /* The report request surfaces directory errors. */
      });
    return () => controller.abort();
  }, [session.baseUrl]);
  useEffect(() => {
    setDraft((prior) => (prior.owner_id === owner ? prior : { ...prior, owner_id: owner }));
    setFilters((prior) => (prior.owner_id === owner ? prior : { ...prior, owner_id: owner }));
  }, [owner]);
  function applyFilters(next) {
    setFilters({ ...next });
    setParams(
      (current) => {
        const query = new URLSearchParams(current);
        if (next.owner_id) query.set('owner_id', next.owner_id);
        else query.delete('owner_id');
        return query;
      },
      { replace: true },
    );
  }
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true });
    setFeedback(null);
    const query = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ''));
    getAdminReport(session.baseUrl, query, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setState({ data, query });
          setOwners(data.owners);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setState({ error: e.message });
      });
    return () => controller.abort();
  }, [session.baseUrl, filters, revision]);
  // Keep exports in the same authenticated session and cancel on navigation/logout.
  const exportController = useRef(null);
  useEffect(() => () => exportController.current?.abort(), [exportController]);
  async function exportFile(format) {
    if (!state.data || exporting) return;
    const controller = new AbortController();
    exportController.current = controller;
    setExporting(format);
    setFeedback(null);
    try {
      const blob = await downloadAdminReport(session.baseUrl, state.query, format, {
        signal: controller.signal,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `maysec-report-${state.query.from_date}-${state.query.to_date}.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setFeedback({
        text: 'Đã xuất báo cáo theo bộ lọc đã áp dụng và ghi nhật ký. Dữ liệu được cập nhật tại thời điểm xuất.',
      });
    } catch (e) {
      if (e.name !== 'AbortError') setFeedback({ error: true, text: e.message });
    } finally {
      setExporting('');
      exportController.current = null;
    }
  }
  const report = state.data;
  const max = Math.max(1, ...(report?.trend.map((d) => d.files) || []));
  return (
    <section className="admin-management" aria-label="Thống kê quản trị">
      <section className="files-section admin-panel">
        <div className="admin-panel-heading">
          <div>
            <h2>Báo cáo vận hành</h2>
            <p>Theo dõi dữ liệu theo thời gian, kết quả xử lý và tài khoản.</p>
          </div>
          <div className="admin-row-actions">
            <button
              className="button secondary"
              disabled={state.loading || Boolean(exporting)}
              onClick={() => refresh((x) => x + 1)}
            >
              <RefreshCw size={16} />
              Làm mới
            </button>
            {['csv', 'pdf'].map((format) => (
              <button
                className={`button ${format === 'pdf' ? 'primary' : 'secondary'}`}
                key={format}
                disabled={!report || Boolean(exporting) || state.loading}
                onClick={() => exportFile(format)}
              >
                <Download size={16} />
                {exporting === format ? 'Đang xuất…' : `Xuất ${format.toUpperCase()}`}
              </button>
            ))}
          </div>
        </div>
        <form
          className="admin-filters"
          onSubmit={(e) => {
            e.preventDefault();
            applyFilters(draft);
          }}
        >
          <label>
            Từ ngày
            <input
              type="date"
              required
              value={draft.from_date}
              max={draft.to_date}
              disabled={Boolean(exporting)}
              onChange={(e) => setDraft({ ...draft, from_date: e.target.value })}
            />
          </label>
          <label>
            Đến ngày
            <input
              type="date"
              required
              value={draft.to_date}
              min={draft.from_date}
              disabled={Boolean(exporting)}
              onChange={(e) => setDraft({ ...draft, to_date: e.target.value })}
            />
          </label>
          <label>
            Tài khoản
            <select
              value={draft.owner_id}
              disabled={Boolean(exporting)}
              onChange={(e) => setDraft({ ...draft, owner_id: e.target.value })}
            >
              <option value="">Tất cả người dùng</option>
              {!owners.some((a) => a.id === draft.owner_id) && draft.owner_id && (
                <option value={draft.owner_id}>Tài khoản đã chọn</option>
              )}
              {owners.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Phạm vi tệp
            <select
              value={draft.lifecycle}
              disabled={Boolean(exporting)}
              onChange={(e) => setDraft({ ...draft, lifecycle: e.target.value })}
            >
              <option value="all">Tất cả, gồm Thùng rác</option>
              <option value="active">Đang hoạt động</option>
              <option value="trashed">Trong Thùng rác</option>
            </select>
          </label>
          <button className="button secondary" disabled={state.loading || Boolean(exporting)}>
            Áp dụng
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={Boolean(exporting)}
            onClick={() => {
              const defaults = { ...recent(30), owner_id: '', lifecycle: 'all' };
              setDraft(defaults);
              applyFilters(defaults);
              setFeedback(null);
            }}
          >
            <RotateCcw size={16} />
            Đặt lại
          </button>
        </form>
        <div className="admin-row-actions admin-presets">
          {[7, 30, 90].map((days) => (
            <button
              className="button text"
              key={days}
              disabled={state.loading || Boolean(exporting)}
              onClick={() => {
                const next = { ...draft, ...recent(days) };
                setDraft(next);
                applyFilters(next);
              }}
            >
              {days} ngày gần đây
            </button>
          ))}
          <span>Ngày tải lên theo giờ Việt Nam · tối đa 366 ngày</span>
        </div>
      </section>
      {feedback && (
        <p
          role={feedback.error ? 'alert' : 'status'}
          className={`banner ${feedback.error ? 'warning' : ''}`}
        >
          {feedback.text}
        </p>
      )}
      {state.error && (
        <div className="banner warning" role="alert">
          {state.error}
          <button className="button secondary" onClick={() => refresh((x) => x + 1)}>
            Thử lại
          </button>
        </div>
      )}
      {state.loading && (
        <p className="admin-empty" role="status">
          Đang tổng hợp báo cáo…
        </p>
      )}
      {report && (
        <>
          <p className="admin-scope">
            {report.scope_note}
            <br />
            Cập nhật <AdminDate value={report.generated_at} inline />. Tệp đã xóa vĩnh viễn không
            còn trong thống kê này.
          </p>
          <div className="admin-summary report-metrics">
            {[
              [Files, 'Tệp trong phạm vi', n(report.totals.files), size(report.totals.bytes)],
              [
                ShieldAlert,
                'Tệp có phát hiện',
                n(report.totals.detected),
                `${n(report.totals.findings)} phát hiện`,
              ],
              [CircleAlert, 'Tệp xử lý lỗi', n(report.totals.errors), 'Quét lỗi hoặc cách ly lỗi'],
              [
                Clock3,
                'Trích xuất trung bình',
                report.totals.extraction_average_ms == null
                  ? '—'
                  : `${(report.totals.extraction_average_ms / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} s`,
                `${n(report.totals.extraction_files)} tệp có dữ liệu thời gian`,
              ],
            ].map(([Icon, label, value, note]) => (
              <div className="admin-metric" key={label}>
                <span>
                  <Icon size={18} />
                  {label}
                </span>
                <strong>{value}</strong>
                <small>{note}</small>
              </div>
            ))}
          </div>
          {report.totals.files === 0 && (
            <p className="banner" role="status">
              Chưa có tệp đã tải lên trong khoảng thời gian và phạm vi này. Có thể thay đổi bộ lọc
              để xem dữ liệu khác.
            </p>
          )}
          <section className="files-section admin-panel">
            <div className="admin-panel-heading">
              <div>
                <h2>Xu hướng theo ngày tải lên</h2>
                <p>Số tệp và số tệp có phát hiện theo kết quả quét mới nhất.</p>
              </div>
              <div className="report-legend">
                <span>Tổng tệp</span>
                <span>Có phát hiện</span>
              </div>
            </div>
            <div
              className="report-chart"
              role="img"
              aria-label={`Biểu đồ ${report.trend.length} ngày: ${report.totals.files} tệp, ${report.totals.detected} tệp có phát hiện. Bảng chi tiết bên dưới.`}
            >
              <svg
                className="report-svg"
                viewBox="0 0 1000 200"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {report.trend.map((day, index) => {
                  const step = 1000 / report.trend.length;
                  const width = step * 0.37;
                  return (
                    <g key={day.date}>
                      <title>{`${day.date}: ${day.files} tệp, ${day.detected} có phát hiện, ${day.errors} lỗi`}</title>
                      <rect
                        x={index * step + step * 0.08}
                        y={200 - (day.files / max) * 190}
                        width={width}
                        height={(day.files / max) * 190}
                        className="report-total-bar"
                      />
                      <rect
                        x={index * step + step * 0.53}
                        y={200 - (day.detected / max) * 190}
                        width={width}
                        height={(day.detected / max) * 190}
                        className="report-detected-bar"
                      />
                    </g>
                  );
                })}
              </svg>
              <div className="report-axis">
                {[
                  report.trend[0],
                  ...(report.trend.length > 2
                    ? [report.trend[Math.floor(report.trend.length / 2)]]
                    : []),
                  ...(report.trend.length > 1 ? [report.trend.at(-1)] : []),
                ].map((day) => (
                  <span key={day.date}>{day.date.slice(5).split('-').reverse().join('/')}</span>
                ))}
              </div>
            </div>
            <details className="report-details">
              <summary>Xem bảng số liệu theo ngày</summary>
              <DataTable
                headers={['Ngày', 'Số tệp', 'Có phát hiện', 'Lỗi']}
                numeric={[1, 2, 3]}
                rows={report.trend.map((d) => [
                  reportDate(d.date),
                  n(d.files),
                  n(d.detected),
                  n(d.errors),
                ])}
              />
            </details>
          </section>
          <div className="admin-report-grid">
            <section className="files-section admin-panel">
              <div className="admin-panel-heading">
                <h2>Kết quả xử lý</h2>
              </div>
              <DataTable
                headers={['Trạng thái', 'Số tệp']}
                numeric={[1]}
                rows={report.statuses.map((r) => [r.label, n(r.files)])}
              />
            </section>
            <section className="files-section admin-panel">
              <div className="admin-panel-heading">
                <div>
                  <h2>Loại phát hiện</h2>
                  <p>Thống kê số lượng, không hiển thị nội dung nhạy cảm.</p>
                </div>
              </div>
              {report.totals.unknown_finding_files > 0 && (
                <p className="banner warning">
                  {n(report.totals.unknown_finding_files)} tệp có phát hiện nhưng thiếu chi tiết
                  theo loại; chưa cộng vào bảng này.
                </p>
              )}
              <DataTable
                headers={['Loại', 'Số phát hiện', 'Số tệp']}
                numeric={[1, 2]}
                rows={report.detections.map((r) => [r.type, n(r.count), n(r.files)])}
              />
            </section>
          </div>
          <section className="files-section admin-panel">
            <div className="admin-panel-heading">
              <h2>Thống kê theo tài khoản</h2>
              <Link className="button secondary" to="/admin/accounts">
                <UsersRound size={16} />
                Quản trị tài khoản
              </Link>
            </div>
            <DataTable
              headers={['Tài khoản', 'Số tệp', 'Dung lượng', 'Có phát hiện', 'Lỗi', 'Thao tác']}
              numeric={[1, 2, 3, 4]}
              widths={['32%', '10%', '15%', '13%', '9%', '21%']}
              className="account-statistics-table"
              rows={report.users.map((r) => [
                <>
                  <strong>{r.name}</strong>
                  <small className="admin-id">{r.id}</small>
                </>,
                n(r.files),
                size(r.bytes),
                n(r.detected),
                n(r.errors),
                <Link className="button secondary" to={`/admin/reports?owner_id=${r.id}`}>
                  Xem tài khoản
                  <ArrowRight size={15} />
                </Link>,
              ])}
            />
          </section>
          <section className="files-section admin-panel">
            <div className="admin-panel-heading">
              <h2>Thời gian trích xuất</h2>
            </div>
            <DataTable
              headers={['Phương thức', 'Số tệp có dữ liệu', 'Trung bình']}
              numeric={[1, 2]}
              rows={report.methods.map((r) => [
                r.label,
                n(r.files),
                `${(r.average_ms / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} giây`,
              ])}
            />
          </section>
        </>
      )}
    </section>
  );
}

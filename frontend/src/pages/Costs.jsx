import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  RefreshCw,
  ReceiptText,
  Wallet,
  UsersRound,
  HardDrive,
  Download,
  CircleAlert,
} from 'lucide-react';
import { useAuth } from '../auth/Auth.jsx';
import { useWorkspace } from '../state/Workspace.jsx';
import {
  getBillingUsage,
  activateBilling,
  setBillingBudget,
  downloadBillingReport,
  reconcileBilling,
} from '../api/client.js';
import { formatStorageUsage as size } from '../utils/storageUsage.js';
import Modal from '../components/Modal.jsx';
import BillingMonthFilter from '../components/BillingMonthFilter.jsx';
import AdminCostStatistics from '../components/AdminCostStatistics.jsx';
import BillingReconciliation from '../components/BillingReconciliation.jsx';
import BillingPeriodHistory from '../components/BillingPeriodHistory.jsx';
import { vnd, useBillingPolicy } from './Pricing.jsx';
import '../billing.css';

const localMonth = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 7);
const at = (value) => new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

export default function Costs({ admin = false }) {
  const { session } = useAuth();
  const w = useWorkspace();
  const policyState = useBillingPolicy();
  const [month, setMonth] = useState(localMonth);
  const [revision, refresh] = useState(0);
  const [state, setState] = useState({ loading: true });
  const [selected, setSelected] = useState(null);
  const [activation, setActivation] = useState(false);
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [budget, setBudget] = useState('');
  const [budgetFeedback, setBudgetFeedback] = useState(null);
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [requestId, setRequestId] = useState(null);
  const latestBudget = useRef(null);
  const budgetDirty = useRef(false);
  const exportController = useRef(null);
  const [exporting, setExporting] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const reconciliationController = useRef(null);
  useEffect(() => {
    latestBudget.current = null;
    budgetDirty.current = false;
    setBudgetFeedback(null);
    return () => {
      exportController.current?.abort();
      reconciliationController.current?.abort();
    };
  }, [session.baseUrl, session.user.id, admin]);
  useEffect(() => () => exportController.current?.abort(), [month]);
  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    setState({ loading: true });
    setSelected(null);
    setShowVersions(false);
    async function load() {
      if (running || controller.signal.aborted) return;
      running = true;
      try {
        const data = await getBillingUsage(session.baseUrl, {
          admin,
          month,
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          const confirmed = latestBudget.current;
          if (confirmed && (data.preferences_revision ?? 0) < confirmed.preferences_revision) {
            Object.assign(data, confirmed);
          } else {
            latestBudget.current = {
              budget_vnd: data.budget_vnd,
              preferences_revision: data.preferences_revision ?? 0,
            };
          }
          setState({ data });
        }
      } catch (error) {
        if (!controller.signal.aborted) setState({ error: error.message });
      } finally {
        running = false;
      }
    }
    void load();
    const timer = setInterval(() => {
      if (!document.hidden && navigator.onLine) void load();
    }, 30000);
    window.addEventListener('maysec:quota-changed', load);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('maysec:quota-changed', load);
    };
  }, [session.baseUrl, session.user.id, admin, month, revision]);
  const data = state.data;
  const policy = policyState.data;
  async function reconcileNow() {
    if (reconciling) return;
    const controller = new AbortController();
    reconciliationController.current = controller;
    setReconciling(true);
    setFeedback(null);
    try {
      const status = await reconcileBilling(session.baseUrl, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setFeedback({
        message:
          status.state === 'ok'
            ? 'Đã đối chiếu dữ liệu chi phí và thông báo.'
            : 'Đã kiểm tra; một số mục cần thử lại. Xem trạng thái đối chiếu bên dưới.',
      });
      window.dispatchEvent(new Event('maysec:notifications-changed'));
      refresh((n) => n + 1);
    } catch (error) {
      if (!controller.signal.aborted) setFeedback({ error: true, message: error.message });
    } finally {
      setReconciling(false);
    }
  }
  useEffect(() => {
    if (data && !budgetDirty.current) setBudget(String(data.budget_vnd));
  }, [data?.budget_vnd]);
  async function enable() {
    if (!consent || !policy) return;
    setPending(true);
    setFeedback(null);
    const id = requestId || crypto.randomUUID();
    setRequestId(id);
    try {
      await activateBilling(session.baseUrl, policy.version, id);
      setActivation(false);
      refresh((n) => n + 1);
      window.dispatchEvent(new Event('maysec:quota-changed'));
      window.dispatchEvent(new Event('maysec:notifications-changed'));
      setFeedback({
        message: 'Đã bật theo dõi chi phí. Chưa thu tiền; quota do quản trị viên đặt vẫn được giữ.',
      });
    } catch (error) {
      setFeedback({ error: true, message: error.message });
    } finally {
      setPending(false);
    }
  }
  async function saveBudget(event) {
    event.preventDefault();
    if (pending) return;
    const previous = data.budget_vnd;
    setPending(true);
    setBudgetSaving(true);
    setBudgetFeedback(null);
    setFeedback(null);
    try {
      const saved = await setBillingBudget(
        session.baseUrl,
        Number(budget),
        data.preferences_revision ?? 0,
        crypto.randomUUID(),
      );
      if ((latestBudget.current?.preferences_revision ?? 0) > saved.preferences_revision) {
        budgetDirty.current = false;
        setBudget(String(latestBudget.current.budget_vnd));
        setBudgetFeedback({
          message: `Ngưỡng đã được cập nhật tiếp ở phiên khác. Hiện đang áp dụng: ${vnd(latestBudget.current.budget_vnd)}.`,
        });
        return;
      }
      latestBudget.current = saved;
      budgetDirty.current = false;
      setBudget(String(saved.budget_vnd));
      setState((prior) => (prior.data ? { ...prior, data: { ...prior.data, ...saved } } : prior));
      setBudgetFeedback({
        message: `Đã lưu ngưỡng cảnh báo mới: ${vnd(saved.budget_vnd)}. Ngưỡng trước đó: ${vnd(previous)}.`,
      });
      window.dispatchEvent(new Event('maysec:notifications-changed'));
    } catch (error) {
      setBudgetFeedback({
        error: true,
        message: `Chưa xác nhận lưu ngưỡng mới. Ngưỡng đã xác nhận gần nhất: ${vnd(previous)}. Hãy cập nhật để kiểm tra. ${error.message}`,
      });
    } finally {
      setPending(false);
      setBudgetSaving(false);
    }
  }
  async function exportCsv() {
    if (!data) return;
    exportController.current?.abort();
    const controller = new AbortController();
    exportController.current = controller;
    setExporting(true);
    try {
      const blob = await downloadBillingReport(session.baseUrl, {
        admin,
        month,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `maysec-chi-phi-${admin ? 'admin-' : ''}${month}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (!controller.signal.aborted) setFeedback({ error: true, message: error.message });
    } finally {
      setExporting(false);
    }
  }
  return (
    <div className="admin-management billing-page">
      <div className="billing-page-intro">
        <p className="page-intro">
          {admin
            ? 'Tổng hợp phí lưu trữ của user và phí quản trị bổ sung. Không thu lưu trữ hai lần.'
            : 'Theo dõi chi phí lưu trữ theo thời gian. OCR, quét PII và thông báo đã bao gồm.'}
        </p>
        <Link to="/pricing" className="button secondary">
          <ReceiptText size={17} />
          Chính sách & bảng giá
        </Link>
      </div>
      <div className="billing-toolbar">
        <BillingMonthFilter value={month} max={localMonth()} onChange={setMonth} />
        <button
          className="button secondary"
          disabled={state.loading}
          onClick={() => refresh((n) => n + 1)}
        >
          <RefreshCw size={16} />
          Cập nhật
        </button>
        {data && (
          <button className="button secondary" onClick={exportCsv} disabled={exporting}>
            <Download size={16} />
            {exporting ? 'Đang xuất bảng kê…' : 'Xuất bảng kê CSV'}
          </button>
        )}
        <span className="admin-tag">Chưa thu tiền</span>
      </div>
      {w.preferences.mode === 'demo' && (
        <p className="banner info">
          Tệp trong chế độ trải nghiệm không được tính phí. Các số dưới đây chỉ lấy từ dữ liệu thật
          đã được backend xác nhận.
        </p>
      )}
      {state.loading && <p role="status">Đang đối chiếu sử dụng và chi phí…</p>}
      {state.error && (
        <p className="banner error" role="alert">
          {state.error}
        </p>
      )}
      {policyState.error && (
        <div className="banner error" role="alert">
          <span>Chưa tải được chính sách: {policyState.error}</span>
          <button className="text-button" onClick={policyState.retry}>
            Tải lại chính sách
          </button>
        </div>
      )}
      {feedback && (
        <p
          className={`banner ${feedback.error ? 'error' : 'success'}`}
          role={feedback.error ? 'alert' : 'status'}
        >
          {feedback.message}
        </p>
      )}
      {data && (
        <>
          {admin && (
            <BillingReconciliation
              status={data.reconciliation}
              busy={reconciling}
              onReconcile={reconcileNow}
            />
          )}
          {!data.historical && data.forecast_vnd > 0 && data.forecast_vnd >= data.budget_vnd && (
            <div className="banner warning">
              <CircleAlert size={18} />
              <span>
                Dự báo {vnd(data.forecast_vnd)} đạt ngưỡng theo dõi {vnd(data.budget_vnd)}. Dữ liệu
                đang lưu vẫn tiếp tục phát sinh chi phí dự kiến.
              </span>
            </div>
          )}
          {admin && data.historical && (
            <p className="banner info">
              Kỳ đã kết thúc · Bản đối chiếu {data.report_revision || 1} ·{' '}
              {data.settlement_status === 'reconciling'
                ? 'Đang đối chiếu'
                : 'Đã đối chiếu dữ liệu ghi nhận'}
              . Dữ liệu ghi muộn được cập nhật bằng bản đối chiếu mới và giữ lại bản trước.
              {data.report_revision > 1 &&
                Number.isFinite(data.adjustment_vnd) &&
                ` Tổng phí ${data.adjustment_vnd === 0 ? 'không đổi' : `điều chỉnh ${vnd(data.adjustment_vnd)}`} so với bản trước.`}{' '}
              Báo cáo gồm chi phí trong thời gian user được quản lý, không đọc tệp riêng sau khi đổi
              vai trò.
            </p>
          )}
          {admin && data.historical && (
            <button
              className="button secondary billing-history-button"
              onClick={() => setShowVersions(true)}
            >
              Xem lịch sử đối chiếu
            </button>
          )}
          <div className="admin-summary">
            <article className="admin-metric">
              <span>
                <HardDrive size={18} />
                Phí lưu trữ{admin ? ' của user' : ''}
              </span>
              <strong>{vnd(data.storage_vnd)}</strong>
              <small>Đã phát sinh trong kỳ đến thời điểm đối chiếu</small>
            </article>
            <article className="admin-metric">
              <span>
                {admin ? <UsersRound size={18} /> : <Wallet size={18} />}
                {admin ? 'Phí quản trị bổ sung' : 'Dự kiến cuối kỳ'}
              </span>
              <strong>{vnd(admin ? data.management_vnd : data.forecast_vnd)}</strong>
              <small>
                {admin
                  ? `${data.accounts_count} user ${data.historical ? 'được quản lý trong kỳ' : 'hiện được quản lý'} · Tính theo thời gian`
                  : 'Nếu giữ nguyên dung lượng hiện tại'}
              </small>
            </article>
            <article className="admin-metric">
              <span>
                <Wallet size={18} />
                {admin ? 'Tổng chi phí dự kiến' : 'Dung lượng đang lưu'}
              </span>
              <strong>{admin ? vnd(data.total_vnd) : size(data.usage.used_bytes)}</strong>
              <small>
                {admin
                  ? `Dự báo cuối kỳ: ${vnd(data.forecast_vnd)}`
                  : `${size(data.free_bytes)} miễn phí · Hạn mức ${size(data.usage.limit_bytes)}`}
              </small>
            </article>
          </div>
          {admin && <AdminCostStatistics key={data.month} data={data} onSelect={setSelected} />}
          {admin ? (
            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div>
                  <h2>Chi phí theo từng user</h2>
                  <p>
                    {data.historical
                      ? 'Bản tổng hợp của kỳ đã kết thúc.'
                      : `Tổng đang lưu ${size(data.used_bytes)}.`}{' '}
                    Phí quản trị là khoản bổ sung ở cấp quản trị.
                  </p>
                </div>
              </div>
              <div className="admin-table-scroll">
                <table className="admin-table billing-user-table">
                  <thead>
                    <tr>
                      <th>Tài khoản</th>
                      <th>Đang lưu</th>
                      <th>Lưu trữ</th>
                      <th>Quản trị</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((r) => (
                      <tr key={r.id}>
                        <td>
                          {r.name}
                          {!r.present && (
                            <small className="billing-muted"> · Đã rời danh sách</small>
                          )}
                        </td>
                        <td data-label="Đang lưu">
                          {r.summary ? size(r.summary.usage.used_bytes) : 'Chỉ giữ lịch sử chi phí'}
                        </td>
                        <td data-label="Phí lưu trữ">{vnd(r.storage_vnd)}</td>
                        <td data-label="Phí quản trị">{vnd(r.management_vnd)}</td>
                        <td>
                          <button className="text-button" onClick={() => setSelected(r)}>
                            Chi tiết
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.items.length && (
                  <p className="admin-empty">Chưa có user trong phạm vi thống kê.</p>
                )}
              </div>
            </section>
          ) : (
            <section className="settings-section">
              <h2>Sử dụng và chế độ tính phí</h2>
              <dl className="billing-details">
                <div>
                  <dt>Chế độ</dt>
                  <dd>
                    {data.payg_enabled
                      ? 'Đã bật tính phí theo sử dụng'
                      : 'Miễn phí — chưa bật phí vượt mức'}
                  </dd>
                </div>
                <div>
                  <dt>Phần dung lượng tính phí hiện tại</dt>
                  <dd>{size(data.billable_bytes)}</dd>
                </div>
                <div>
                  <dt>Đang giữ chỗ — chưa tính phí</dt>
                  <dd>{size(data.usage.reserved_bytes)}</dd>
                </div>
                <div>
                  <dt>Đơn giá áp dụng</dt>
                  <dd>{vnd(data.storage_rate)}/GB/tháng</dd>
                </div>
                <div>
                  <dt>Bắt đầu ghi nhận</dt>
                  <dd>{at(data.tracking_started_at)}</dd>
                </div>
              </dl>
              {!data.payg_enabled && (
                <button
                  className="button primary"
                  disabled={!policy}
                  onClick={() => {
                    setConsent(false);
                    setActivation(true);
                  }}
                >
                  Dùng thử tính phí theo sử dụng
                </button>
              )}
              {data.payg_enabled && data.usage.limit_bytes <= data.free_bytes && (
                <p className="banner info">
                  Hạn mức do admin đặt vẫn đang áp dụng. Liên hệ quản trị viên nếu cần lưu thêm.
                </p>
              )}
            </section>
          )}
          {data.processing && (
            <section className="settings-section">
              <h2>OCR và xử lý đã bao gồm</h2>
              <dl className="billing-details">
                <div>
                  <dt>Lượt xử lý ghi nhận trong kỳ</dt>
                  <dd>{data.processing.scan_runs}</dd>
                </div>
                <div>
                  <dt>Lượt dùng OCR</dt>
                  <dd>{data.processing.ocr_runs}</dd>
                </div>
                <div>
                  <dt>Trang OCR đã trích xuất</dt>
                  <dd>{data.processing.ocr_extracted_pages}</dd>
                </div>
                <div>
                  <dt>Lỗi hoặc chưa hỗ trợ quét</dt>
                  <dd>{data.processing.error_runs}</dd>
                </div>
                <div>
                  <dt>Phí xử lý cộng thêm</dt>
                  <dd>{vnd(data.processing.processing_vnd)}</dd>
                </div>
              </dl>
              <p className="billing-muted">
                Chỉ đếm các kết quả xử lý được ghi nhận từ khi bổ sung chức năng này; không khôi
                phục số lượt cũ và không phải số trang tính tiền AWS. Quét lại vẫn theo giới hạn
                hiện có.
              </p>
            </section>
          )}
          <section className="settings-section">
            <h2>Cảnh báo chi phí</h2>
            <p className="billing-muted">
              {admin
                ? 'Ngưỡng riêng của bạn cho kỳ hiện tại: tổng lưu trữ user và phí quản trị toàn hệ thống demo.'
                : 'Ngưỡng theo dõi chi phí lưu trữ của riêng tài khoản bạn trong kỳ hiện tại.'}
            </p>
            <div className="billing-budget-current">
              <span>Ngưỡng cảnh báo hiện tại</span>
              <strong>{vnd(data.budget_vnd)}</strong>
            </div>
            <form onSubmit={saveBudget} className="billing-budget">
              <label>
                Ngưỡng cảnh báo mới (đồng)
                <input
                  required
                  type="number"
                  min="0"
                  max="1000000000"
                  step="1"
                  value={budget}
                  onChange={(e) => {
                    budgetDirty.current = true;
                    setBudget(e.target.value);
                    setBudgetFeedback(null);
                  }}
                  disabled={budgetSaving}
                />
              </label>
              <button type="submit" className="button secondary" disabled={pending}>
                {budgetSaving ? 'Đang lưu ngưỡng…' : 'Lưu ngưỡng cảnh báo'}
              </button>
            </form>
            {budgetFeedback && (
              <p
                className={`banner ${budgetFeedback.error ? 'error' : 'success'}`}
                role={budgetFeedback.error ? 'alert' : 'status'}
              >
                {budgetFeedback.message}
              </p>
            )}
            <p className="billing-muted">
              Nhắc qua chuông khi dự báo hoặc chi phí phát sinh đạt ngưỡng. Ngưỡng chỉ để theo dõi,
              không thay đổi bảng giá, hạn mức tải lên hoặc tự dừng phí dữ liệu còn lưu. Ngưỡng 0 đ
              sẽ nhắc khi có chi phí dương.
            </p>
          </section>
          {!admin && <DailyTable data={data} />}
          <p className="billing-muted billing-caption">
            Đối chiếu lúc {at(data.checked_at || data.as_of)} · Chính sách {data.policy_version}. Dữ
            liệu trước mốc ghi nhận không được tính ngược.
          </p>
        </>
      )}
      {activation && policy && (
        <Modal
          title="Bật tính phí theo sử dụng"
          onClose={() => {
            if (!pending) setActivation(false);
          }}
        >
          <div className="billing-dialog">
            <p>
              1 GB đầu miễn phí; phần vượt mức <strong>{vnd(policy.storage_rate)}/GB/tháng</strong>,
              tính theo thời gian lưu thực tế.
            </p>
            <p>
              OCR, quét PII và thông báo đã bao gồm. Chưa thu tiền hoặc tạo công nợ. Hạn mức dùng
              thử tối đa mặc định {size(policy.trial_limit_bytes)}; hạn mức admin đã đặt được giữ
              nguyên.
            </p>
            <Link to="/pricing" onClick={() => setActivation(false)}>
              Đọc chính sách {policy.version}
            </Link>
            <label className="billing-consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              Tôi đã đọc chính sách và đồng ý bật theo dõi chi phí dự kiến.
            </label>
            {feedback?.error && (
              <p className="banner error" role="alert">
                {feedback.message}
              </p>
            )}
            <button className="button primary" disabled={!consent || pending} onClick={enable}>
              {pending ? 'Đang xác nhận…' : 'Xác nhận dùng thử'}
            </button>
          </div>
        </Modal>
      )}
      {selected && (
        <Modal title={`Chi phí · ${selected.name}`} onClose={() => setSelected(null)} wide>
          <div className="billing-dialog">
            <dl className="billing-details">
              <div>
                <dt>Được quản lý từ</dt>
                <dd>{at(selected.managed_since)}</dd>
              </div>
              <div>
                <dt>Phí quản trị trong kỳ</dt>
                <dd>{vnd(selected.management_vnd)}</dd>
              </div>
              <div>
                <dt>Phí lưu trữ trong kỳ</dt>
                <dd>{vnd(selected.storage_vnd)}</dd>
              </div>
              {selected.summary && (
                <>
                  <div>
                    <dt>Đang dùng / hạn mức upload</dt>
                    <dd>
                      {size(selected.summary.usage.used_bytes)} /{' '}
                      {size(selected.summary.usage.limit_bytes)}
                    </dd>
                  </div>
                  <div>
                    <dt>Chế độ</dt>
                    <dd>
                      {selected.summary.payg_enabled
                        ? 'Tính phí theo sử dụng'
                        : 'Chưa bật phí vượt mức'}
                    </dd>
                  </div>
                </>
              )}
            </dl>
            {(selected.cost_summary || selected.summary) && (
              <DailyTable data={selected.cost_summary || selected.summary} />
            )}
            {selected.present && selected.summary && (
              <Link
                className="button secondary"
                to="/admin/accounts"
                onClick={() => setSelected(null)}
              >
                Mở quản trị tài khoản để chỉnh quota
              </Link>
            )}
          </div>
        </Modal>
      )}
      {showVersions && (
        <BillingPeriodHistory
          baseUrl={session.baseUrl}
          month={month}
          onClose={() => setShowVersions(false)}
        />
      )}
    </div>
  );
}

function DailyTable({ data }) {
  return (
    <section className="settings-section">
      <h2>Lịch sử chi phí theo ngày</h2>
      <p className="billing-muted">
        Các ngày làm tròn để dễ đọc; tổng kỳ được tính trước khi làm tròn.
      </p>
      <div className="admin-table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Ngày</th>
              <th>Phí lưu trữ dự kiến</th>
            </tr>
          </thead>
          <tbody>
            {data.daily.map((r) => (
              <tr key={r.date}>
                <td>{r.date.split('-').reverse().join('/')}</td>
                <td>{vnd(r.storage_vnd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.daily.length && (
          <p className="admin-empty">Chưa có khoảng thời gian sử dụng được ghi nhận trong kỳ.</p>
        )}
      </div>
    </section>
  );
}

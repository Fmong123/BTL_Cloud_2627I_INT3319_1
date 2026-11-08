import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LockKeyhole,
  Wallet,
  ShieldCheck,
  ReceiptText,
  Calculator,
  RefreshCw,
  HardDrive,
  UserRound,
  UsersRound,
  Bell,
  ScanText,
  Trash2,
  History,
  SlidersHorizontal,
  CheckCircle2,
  Clock3,
  ArrowRight,
} from 'lucide-react';
import { useAuth } from '../auth/Auth.jsx';
import { getBillingPolicy } from '../api/client.js';
import '../admin-management.css';
import '../billing.css';
import { formatStorageUsage as size } from '../utils/storageUsage.js';

export const vnd = (value) =>
  `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value)} đ`;

export function useBillingPolicy() {
  const { session } = useAuth();
  const [revision, refresh] = useState(0);
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true });
    getBillingPolicy(session.baseUrl, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setState({ data });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setState({ error: error.message });
      });
    return () => controller.abort();
  }, [session.baseUrl, revision]);
  return { ...state, retry: () => refresh((n) => n + 1) };
}

export function PriceCalculator({ policy }) {
  const [gb, setGb] = useState('6');
  const [days, setDays] = useState('15');
  const [people, setPeople] = useState('3');
  const [mode, setMode] = useState('user');
  const valid =
    [gb, days, people].every((n) => n !== '' && Number.isFinite(+n)) &&
    +gb >= 0 &&
    +gb <= 10000 &&
    +days >= 1 &&
    +days <= 30 &&
    +people >= 1 &&
    +people <= 200;
  const storage = (Math.max(0, +gb - 1) * policy.storage_rate * +days) / 30;
  const management = (+people * policy.management_rate * +days) / 30;
  return (
    <section className="settings-section billing-calculator">
      <div className="section-title">
        <span className="section-icon">
          <Calculator size={22} />
        </span>
        <div>
          <h2>Ước tính trước khi sử dụng</h2>
          <p>Kỳ minh họa 30 ngày, dung lượng giữ nguyên trong số ngày đã chọn.</p>
        </div>
      </div>
      <div className="billing-form-grid">
        <label>
          Phạm vi ước tính
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="user">User — lưu trữ cá nhân</option>
            <option value="admin">Admin — các user có cùng mức sử dụng</option>
          </select>
        </label>
        <label>
          Dung lượng mỗi user (GB)
          <input
            type="number"
            min="0"
            max="10000"
            step="0.1"
            value={gb}
            onChange={(e) => setGb(e.target.value)}
          />
        </label>
        <label>
          Thời gian sử dụng (ngày)
          <input
            type="number"
            min="1"
            max="30"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </label>
        {mode === 'admin' && (
          <label>
            Số user được quản lý
            <input
              type="number"
              min="1"
              max="200"
              value={people}
              onChange={(e) => setPeople(e.target.value)}
            />
          </label>
        )}
      </div>
      <div className="billing-calculation" aria-live="polite">
        {valid ? (
          <>
            <span>Chi phí dự kiến</span>
            <strong>{vnd(mode === 'user' ? storage : storage * +people + management)}</strong>
            <p>
              {mode === 'user'
                ? 'Đã trừ 1 GB miễn phí. OCR, quét PII và thông báo đã bao gồm.'
                : `Lưu trữ ${vnd(storage * +people)} + quản trị ${vnd(management)}. Không cộng phí lưu trữ lần thứ hai.`}
            </p>
          </>
        ) : (
          <p role="alert">Nhập số hợp lệ: 0–10.000 GB, 1–30 ngày và 1–200 user.</p>
        )}
      </div>
      <p className="billing-muted">
        Công cụ chỉ minh họa chi phí, không cấp thêm hạn mức tải lên. Hạn mức mặc định sau khi bật
        là {size(policy.trial_limit_bytes)} tổng dung lượng; tài khoản có hạn mức riêng do admin đặt
        sẽ dùng mức đó.
      </p>
    </section>
  );
}

export default function Pricing() {
  const { session } = useAuth();
  const state = useBillingPolicy();
  const policy = state.data;
  return (
    <div className="admin-management billing-page">
      <div className="billing-page-intro">
        <p className="page-intro">
          Chính sách sử dụng và cơ sở định giá. Theo dõi chi phí cá nhân hoặc toàn hệ thống ở lối
          tắt riêng.
        </p>
        <Link
          className="button secondary"
          to={session.user.role === 'admin' ? '/admin/costs' : '/costs'}
        >
          <Wallet size={17} />
          Theo dõi chi phí
        </Link>
      </div>
      {state.loading && <p role="status">Đang tải chính sách…</p>}
      {state.error && (
        <div className="banner error" role="alert">
          {state.error}
          <button className="text-button" onClick={state.retry}>
            <RefreshCw size={16} />
            Thử lại
          </button>
        </div>
      )}
      {policy && (
        <>
          <div className="billing-policy-meta">
            <span>
              <LockKeyhole size={16} />
              Chính sách do bên phát triển quy định · Chỉ đọc
            </span>
            <span>
              {policy.version} · Sydney · Đối chiếu {policy.checked_at}
            </span>
          </div>
          <div className="admin-summary billing-price-grid">
            <article className="admin-metric">
              <span>
                <ShieldCheck size={18} />
                Mức miễn phí
              </span>
              <strong>1 GB</strong>
              <small>Cho mỗi user; không nhân theo số admin.</small>
            </article>
            <article className="admin-metric">
              <span>
                <ReceiptText size={18} />
                Lưu trữ theo sử dụng
              </span>
              <strong>{vnd(policy.storage_rate)}</strong>
              <small>/ GB / tháng, chỉ phần vượt miễn phí và thời gian thực tế.</small>
            </article>
            <article className="admin-metric">
              <span>
                <Wallet size={18} />
                Quản trị bổ sung
              </span>
              <strong>{vnd(policy.management_rate)}</strong>
              <small>/ user được quản lý / tháng, tính theo thời gian.</small>
            </article>
          </div>
          <p className="banner info">
            {policy.tax_note} OCR, quét PII, mã hóa, cách ly và thông báo đã bao gồm trong phạm vi
            xử lý được hỗ trợ.
          </p>
          <PriceCalculator policy={policy} />
          <section className="settings-section">
            <h2>Hạn mức lưu trữ cần biết</h2>
            <div className="billing-quota-heading">
              <span>Tổng hạn mức mặc định sau khi bật</span>
              <strong>
                {size(policy.trial_limit_bytes)} <HardDrive size={20} aria-hidden="true" />
              </strong>
            </div>
            <div
              className="billing-quota-diagram"
              role="img"
              aria-label={`${size(policy.trial_limit_bytes)} gồm ${size(policy.free_bytes)} miễn phí và ${size(policy.trial_limit_bytes - policy.free_bytes)} tính phí theo sử dụng`}
            >
              <span
                className="billing-quota-free"
                style={{ width: `${(policy.free_bytes / policy.trial_limit_bytes) * 100}%` }}
              />
              <span className="billing-quota-paid" />
            </div>
            <div className="billing-quota-legend">
              <div>
                <span className="billing-quota-dot free" />
                <div>
                  <strong>{size(policy.free_bytes)} miễn phí</strong>
                  <small>Riêng cho mỗi người dùng</small>
                </div>
              </div>
              <div>
                <span className="billing-quota-dot paid" />
                <div>
                  <strong>
                    Tối đa {size(policy.trial_limit_bytes - policy.free_bytes)} vượt mức
                  </strong>
                  <small>{vnd(policy.storage_rate)}/GB/tháng · Theo thời gian lưu</small>
                </div>
              </div>
            </div>
            <div className="billing-quota-example">
              <span>Ví dụ: giữ {size(policy.trial_limit_bytes)} cả tháng sau khi bật</span>
              <ArrowRight size={16} aria-hidden="true" />
              <strong>
                {vnd(
                  ((policy.trial_limit_bytes - policy.free_bytes) / policy.free_bytes) *
                    policy.storage_rate,
                )}
              </strong>
            </div>
            <p className="billing-muted">
              Giữ hạn mức riêng nếu admin đã cấp. Không cho tải vượt phần còn trống, kể cả dung
              lượng đang giữ chỗ; cần dọn dữ liệu hoặc được tăng hạn mức.
            </p>
          </section>
          <section className="settings-section">
            <h2>Cách tính và phạm vi sử dụng</h2>
            <div className="billing-formulas">
              <div className="billing-formula">
                <h3>
                  <UserRound size={18} aria-hidden="true" /> Phí lưu trữ của người dùng
                </h3>
                <div className="billing-equation">
                  <span>GB vượt miễn phí</span>
                  <b aria-hidden="true">×</b>
                  <span>{vnd(policy.storage_rate)}</span>
                  <b aria-hidden="true">×</b>
                  <span>Tỷ lệ thời gian trong tháng</span>
                </div>
                <p>Trừ {size(policy.free_bytes)} miễn phí, chỉ tính từ khi xác nhận bật.</p>
              </div>
              <div className="billing-formula">
                <h3>
                  <UsersRound size={18} aria-hidden="true" /> Tổng chi phí phía admin
                </h3>
                <div className="billing-equation">
                  <span>Tổng lưu trữ của user</span>
                  <b aria-hidden="true">+</b>
                  <span>Phí quản trị</span>
                </div>
                <p>
                  Quản trị {vnd(policy.management_rate)}/user/tháng theo thời gian; không tính lưu
                  trữ hai lần.
                </p>
              </div>
            </div>
            <ol className="billing-policy-flow" aria-label="Quá trình ghi nhận chi phí">
              <li>
                <CheckCircle2 size={18} aria-hidden="true" />
                <div>
                  <strong>Xác nhận bật</strong>
                  <span>Không tính ngược trước đó</span>
                </div>
              </li>
              <li>
                <Clock3 size={18} aria-hidden="true" />
                <div>
                  <strong>Ghi nhận thời gian lưu</strong>
                  <span>Kỳ tháng theo giờ Việt Nam</span>
                </div>
              </li>
              <li>
                <ReceiptText size={18} aria-hidden="true" />
                <div>
                  <strong>Theo dõi ước tính</strong>
                  <span>Chưa thu tiền, chưa có công nợ</span>
                </div>
              </li>
            </ol>
          </section>
          <div className="billing-role-grid">
            <section className="settings-section billing-role-section">
              <div className="billing-role-heading">
                <UserRound size={20} aria-hidden="true" />
                <h2>Thông tin dành cho người dùng</h2>
              </div>
              <PolicyPoint icon={ScanText} title="OCR và quét đã bao gồm">
                Không cộng phí theo trang hay lượt quét. Áp dụng giới hạn xử lý hiện có.
              </PolicyPoint>
              <PolicyPoint icon={Trash2} title="Xóa vĩnh viễn mới ngừng tính">
                Thùng rác và cách ly vẫn chiếm dung lượng. Chỗ đang giữ cho upload chưa tính phí.
              </PolicyPoint>
              <PolicyPoint icon={Bell} title="Cảnh báo để bạn chủ động">
                <span className="billing-alert-bands">
                  <span>80%</span>
                  <span>90%</span>
                  <span>100%</span>
                  <small>mức miễn phí</small>
                </span>
                Ngưỡng tiền chỉ nhắc nhở, không tự dừng phí. Bạn xem và xuất bảng kê của mình.
              </PolicyPoint>
            </section>
            <section className="settings-section billing-role-section">
              <div className="billing-role-heading">
                <UsersRound size={20} aria-hidden="true" />
                <h2>Thông tin dành cho admin</h2>
              </div>
              <PolicyPoint icon={SlidersHorizontal} title="Quản lý hạn mức và cảnh báo">
                Được chỉnh hạn mức tải lên, ngưỡng nhắc nhở. Giá và mức miễn phí do bên phát triển
                quy định.
              </PolicyPoint>
              <PolicyPoint icon={UsersRound} title="Tính theo user được quản lý">
                User bị khóa vẫn tính phí quản trị; không phụ thuộc đăng nhập hoặc số admin.
              </PolicyPoint>
              <PolicyPoint icon={History} title="Giữ lịch sử và có đối chiếu">
                Giữ chi phí khi user đổi vai trò/rời nhóm. Xem thống kê, xuất CSV và tra nhật ký
                thay đổi.
              </PolicyPoint>
            </section>
          </div>
          <details className="settings-section billing-policy-disclosure">
            <summary>Đọc đầy đủ chính sách và các trường hợp áp dụng</summary>
            <p className="billing-muted">
              Chi tiết về ghi nhận, cảnh báo, làm tròn và quyền của từng vai trò.
            </p>
            <PolicyRules title="Quy tắc chung" rules={policy.rules} />
            <PolicyRules title="Quy định cho người dùng" rules={policy.user_policy} />
            <PolicyRules title="Quy định cho admin" rules={policy.admin_policy} />
          </details>
          <details className="billing-assumptions">
            <summary>Giá dịch vụ được xây dựng như thế nào?</summary>
            <p className="billing-muted">
              Giá tham khảo chi phí lưu trữ, xử lý tài liệu và vận hành trên AWS tại Sydney. Các chi
              phí này đã được gộp vào giá dịch vụ MâySec, không cộng riêng vào tiền của bạn. Giá
              hiện là dự kiến, chưa phải hóa đơn AWS thực tế.
            </p>
          </details>
        </>
      )}
    </div>
  );
}

function PolicyPoint({ icon: Icon, title, children }) {
  return (
    <div className="billing-policy-point">
      <span className="billing-policy-icon">
        <Icon size={18} aria-hidden="true" />
      </span>
      <div>
        <h3>{title}</h3>
        <div className="billing-policy-point-copy">{children}</div>
      </div>
    </div>
  );
}

function PolicyRules({ title, rules = [] }) {
  return (
    <div className="billing-policy-full-rules">
      <h3>{title}</h3>
      <ul className="billing-rules">
        {rules.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
    </div>
  );
}

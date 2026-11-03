import { useState } from 'react';
import {
  ArrowRight,
  Cloud,
  Layers2,
  RefreshCw,
  ShieldCheck,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { useAuth } from './Auth.jsx';
import { cognitoConfig } from './cognito.js';
import './login.css';

export default function Login() {
  const auth = useAuth();
  const [address, setAddress] = useState(auth.baseUrl);
  const [search, setSearch] = useState('');
  const accounts = auth.accounts.filter((a) =>
    `${a.name} ${a.username}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <main className="login-page">
      <div className="login-shell">
        <div className="login-brand">
          <span className="brand-mark">
            <Layers2 size={25} />
          </span>
          <span className="brand-wordmark">MâySec</span>
        </div>
        <section className="login-frame" aria-label="Đăng nhập MâySec">
          <div className="login-story">
            <span className="eyebrow">KHÔNG GIAN CỦA BẠN</span>
            <h1>
              Không gian riêng <br />
              cho tài liệu <br />
              <span>quan trọng</span>
            </h1>
            <p>Lưu trữ tài liệu gọn gàng và theo dõi kết quả kiểm tra bảo mật</p>
            <div className="login-cloud" aria-hidden="true">
              <Cloud size={112} strokeWidth={1.2} />
              <span>
                <ShieldCheck size={28} />
              </span>
            </div>
            <div className="login-assurance">
              <ShieldCheck size={18} />
              <span>Kiểm soát truy cập theo tài khoản</span>
            </div>
          </div>
          <div className="login-panel">
            <span className="login-kicker">
              <UsersRound size={18} /> CHÀO MỪNG TRỞ LẠI
            </span>
            <h2>Chọn tài khoản để tiếp tục</h2>
            <p className="login-intro">Tệp và hoạt động được tách riêng theo từng tài khoản</p>
            <div className="login-list-heading">
              <strong>Tài khoản{auth.config?.demo_enabled ? ' demo' : ''}</strong>
              <button
                className="icon-button"
                aria-label="Cập nhật danh sách tài khoản"
                disabled={auth.loading || Boolean(auth.busy)}
                onClick={auth.refresh}
              >
                <RefreshCw size={17} className={auth.loading ? 'login-spin' : ''} />
              </button>
            </div>
            {auth.accounts.length > 5 && (
              <input
                className="login-search"
                type="search"
                aria-label="Tìm tài khoản"
                placeholder="Tìm tài khoản…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            )}
            <div className="account-list" aria-busy={auth.loading || Boolean(auth.busy)}>
              {accounts.map((account, index) => (
                <button
                  key={account.id}
                  className={`account-card ${account.role === 'admin' ? 'account-admin' : ''}`}
                  disabled={!account.active || Boolean(auth.busy)}
                  onClick={() => auth.choose(account)}
                >
                  <span className={`account-avatar avatar-${index % 3}`}>
                    {account.role === 'admin' ? <ShieldCheck size={23} /> : <UserRound size={23} />}
                  </span>
                  <span className="account-copy">
                    <strong>{account.name}</strong>
                    <small>
                      {account.active
                        ? account.role === 'admin'
                          ? 'Quản trị viên'
                          : 'Không gian cá nhân'
                        : 'Chưa được kích hoạt hoặc chưa có nhóm'}
                    </small>
                  </span>
                  {auth.busy === account.id ? (
                    <RefreshCw className="login-spin" size={19} />
                  ) : (
                    <ArrowRight size={19} />
                  )}
                </button>
              ))}
              {auth.loading && !accounts.length && (
                <p role="status" className="login-empty">
                  Đang cập nhật danh sách tài khoản…
                </p>
              )}
              {!auth.loading && auth.config?.demo_enabled && !accounts.length && !auth.error && (
                <p className="login-empty">
                  Chưa có tài khoản phù hợp, danh sách sẽ tự cập nhật khi có tài khoản mới
                </p>
              )}
              {!auth.loading &&
                auth.config?.auth_mode === 'cognito' &&
                !auth.config.demo_enabled && (
                  <p className="login-empty">
                    Chế độ chọn tài khoản đang tắt, hãy dùng đăng nhập Cognito
                  </p>
                )}
            </div>
            {auth.config?.auth_mode === 'dev' && (
              <button
                className="button primary login-standard"
                disabled={Boolean(auth.busy)}
                onClick={auth.loginLocal}
              >
                Vào không gian thử cục bộ <ArrowRight size={16} />
              </button>
            )}
            {auth.error && (
              <p className="login-error" role="alert">
                {auth.error}
              </p>
            )}
            {cognitoConfig().domain && (
              <button
                className="button secondary login-standard"
                disabled={Boolean(auth.busy)}
                onClick={auth.loginCognito}
              >
                Đăng nhập bằng Cognito <ArrowRight size={16} />
              </button>
            )}
            {import.meta.env.VITE_UPLOAD_MODE === 'demo' && (
              <button className="text-button login-standard" onClick={auth.explore}>
                Trải nghiệm giao diện · không lưu lên AWS
              </button>
            )}
            <p className="login-footnote">
              {auth.config?.demo_enabled
                ? 'Chế độ trình diễn — chọn tài khoản để vào ngay'
                : 'MâySec — Không gian lưu trữ an toàn'}
            </p>
            <details className="login-connection">
              <summary>Kết nối máy chủ</summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  auth.connect(address);
                }}
              >
                <label htmlFor="login-api">Địa chỉ API</label>
                <input
                  id="login-api"
                  type="url"
                  required
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
                <button className="button secondary" disabled={Boolean(auth.busy)}>
                  Kết nối
                </button>
              </form>
            </details>
          </div>
        </section>
        <footer className="login-footer">
          <span>Lưu trữ và bảo vệ tài liệu</span>
          <span>MâySec</span>
        </footer>
      </div>
    </main>
  );
}

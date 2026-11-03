import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, RefreshCw, ShieldAlert, ShieldCheck, Clock3, UsersRound } from 'lucide-react';
import { useAuth } from '../auth/Auth.jsx';
import { getSecurityOverview } from '../api/client.js';
import '../admin-quarantine.css';

export default function AdminOverview() {
  const { session } = useAuth();
  const [revision, refresh] = useState(0);
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true });
    async function load() {
      const counts = {};
      const seen = new Set();
      let cursor = null;
      do {
        const result = await getSecurityOverview(session.baseUrl, {
          cursor,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        for (const [key, count] of Object.entries(result.counts))
          counts[key] = (counts[key] || 0) + count;
        cursor = result.next_cursor;
        if (cursor && seen.has(cursor)) throw new Error('Thống kê chưa hoàn tất. Hãy tải lại.');
        if (cursor) seen.add(cursor);
        if (!cursor) setState({ counts, users: result.users, at: Date.now(), loading: false });
      } while (cursor);
    }
    load().catch((error) => {
      if (!controller.signal.aborted)
        setState({
          error:
            error.status === 404
              ? 'Máy chủ chưa có chức năng tổng quan bảo mật. Cần cập nhật và khởi động lại backend.'
              : error.message,
          loading: false,
        });
    });
    return () => controller.abort();
  }, [session.baseUrl, revision]);
  const cards = [
    ['Chờ cách ly', 'flagged', Clock3, 'purple'],
    ['Đã cách ly', 'quarantined', ShieldCheck, 'green'],
    ['Cách ly lỗi', 'quarantine_delete_failed', ShieldAlert, 'pink'],
  ];
  return (
    <section className="security-overview" aria-label="Tổng quan bảo mật hệ thống">
      {state.error && (
        <p className="banner warning" role="alert">
          {state.error}
        </p>
      )}
      <div className="overview-stats security-stats">
        <div className="stat blue">
          <span className="stat-label">
            <UsersRound size={20} />
            Tài khoản trong hệ thống
          </span>
          <strong>{state.users ?? '—'}</strong>
          <span className="stat-link">Phạm vi quản trị của bạn</span>
        </div>
        {cards.map(([label, status, Icon, color]) => (
          <Link className={`stat ${color}`} key={status} to={`/admin/quarantine?status=${status}`}>
            <span className="stat-label">
              <Icon size={20} />
              {label}
            </span>
            <strong>{state.counts?.[status] ?? '—'}</strong>
            <span className="stat-link">
              Xem danh sách <ArrowRight size={16} />
            </span>
          </Link>
        ))}
      </div>
      <div className="files-section security-guide">
        <div className="files-heading">
          <div>
            <h2>Theo dõi bảo mật dữ liệu</h2>
            <p className="security-updated" role="status">
              {state.loading
                ? 'Đang tổng hợp dữ liệu từ hệ thống…'
                : state.at
                  ? `Cập nhật lúc ${new Date(state.at).toLocaleString('vi-VN')}`
                  : 'Chưa có thống kê được xác nhận.'}
            </p>
          </div>
          <button
            className="button secondary"
            disabled={state.loading}
            onClick={() => refresh((x) => x + 1)}
          >
            <RefreshCw size={16} />
            Làm mới thống kê
          </button>
        </div>
        <div className="security-guide-content">
          <div className="security-guide-title">
            <ShieldCheck size={22} />
            <h3>Xử lý tệp cần chú ý</h3>
          </div>
          <p>
            Mở danh sách cách ly để kiểm tra chủ sở hữu, kết quả phát hiện và lịch sử. Việc tải bản
            cách ly được ghi lại; các tệp chưa an toàn tiếp tục bị chặn trong Drive cá nhân.
          </p>
          <Link className="button secondary" to="/admin/quarantine">
            Mở quản trị cách ly <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </section>
  );
}

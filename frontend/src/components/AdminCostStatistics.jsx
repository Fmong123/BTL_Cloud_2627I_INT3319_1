import { useState } from 'react';
import { ChartNoAxesCombined, UsersRound, TrendingUp, Wallet } from 'lucide-react';
import { summarizeUserCosts, weeklyUserCosts } from '../utils/billing.js';
import { vnd } from '../pages/Pricing.jsx';

export default function AdminCostStatistics({ data, onSelect }) {
  const stats = summarizeUserCosts(data.items);
  const weeks = weeklyUserCosts(data.items, data.month);
  const [selected, setSelected] = useState(null);
  const max = Math.max(0, ...weeks.map((week) => week.cost));
  const active = weeks[selected] || weeks.find((week) => week.cost === max);
  const month = data.month.slice(5);
  const label = (week) =>
    `${String(week.start).padStart(2, '0')}–${String(week.end).padStart(2, '0')}/${month}`;
  return (
    <section
      className="settings-section billing-statistics"
      aria-label="Thống kê chi phí người dùng"
    >
      <div className="billing-statistics-heading">
        <div>
          <h2>Thống kê chi phí người dùng</h2>
          <p className="billing-muted">
            Phân tích phí lưu trữ trong kỳ đã chọn; phí quản trị được tổng hợp riêng ở phía trên.
            Bao gồm lịch sử chi phí của tài khoản đã rời danh sách.
          </p>
        </div>
        <span className="admin-tag">
          {stats.enabledCount}/{stats.usersCount} user đã bật theo dõi phí
        </span>
      </div>
      <dl className="billing-statistics-metrics">
        <div>
          <dt>
            <UsersRound size={17} />
            User có phát sinh phí
          </dt>
          <dd>
            {stats.chargedCount}
            <small> / {stats.usersCount} user</small>
          </dd>
        </div>
        <div>
          <dt>
            <Wallet size={17} />
            Lưu trữ bình quân / user
          </dt>
          <dd>{vnd(stats.average)}</dd>
        </div>
        <div>
          <dt>
            <TrendingUp size={17} />
            Dự kiến lưu trữ cuối kỳ
          </dt>
          <dd>{vnd(stats.forecast)}</dd>
        </div>
      </dl>
      <div className="billing-statistics-grid">
        <div className="billing-statistics-panel">
          <h3>
            <ChartNoAxesCombined size={18} />
            Chi phí lưu trữ theo tuần
          </h3>
          {max > 0 ? (
            <>
              <div
                className="billing-week-chart"
                role="group"
                aria-label="Chi phí lưu trữ theo các khoảng 7 ngày"
              >
                {weeks.map((week, index) => (
                  <button
                    type="button"
                    key={week.start}
                    className="billing-week"
                    aria-pressed={active?.start === week.start}
                    aria-label={`${label(week)}: ${vnd(week.cost)}`}
                    onClick={() => setSelected(index)}
                  >
                    <span className="billing-week-column">
                      <span
                        className="billing-week-fill"
                        style={{ height: `${(week.cost / max) * 100}%` }}
                      />
                    </span>
                    <span className="billing-week-label">
                      {String(week.start).padStart(2, '0')}–{String(week.end).padStart(2, '0')}
                    </span>
                  </button>
                ))}
              </div>
              <p className="billing-week-detail" aria-live="polite">
                {active && `${label(active)}: ${vnd(active.cost)}`}
              </p>
            </>
          ) : (
            <p className="billing-chart-empty">Chưa phát sinh phí lưu trữ trong kỳ này.</p>
          )}
          <p className="billing-caption billing-muted">
            Theo số liệu từng ngày đã làm tròn; có thể lệch vài đồng so với tổng kỳ.
          </p>
        </div>
        <div className="billing-statistics-panel">
          <h3>Người dùng có chi phí lưu trữ cao nhất</h3>
          {stats.highest.length ? (
            <ol className="billing-cost-ranking">
              {stats.highest.map((row, index) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(row)}
                    aria-label={`Chi tiết chi phí ${row.name}`}
                  >
                    <span className="billing-ranking-order">{index + 1}</span>
                    <span className="billing-ranking-name">
                      {row.name}
                      <small>
                        {new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(
                          (row.storage_vnd / stats.total) * 100,
                        )}
                        % phí lưu trữ
                      </small>
                    </span>
                    <strong>{vnd(row.storage_vnd)}</strong>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="billing-chart-empty">Chưa có user phát sinh phí để xếp hạng.</p>
          )}
        </div>
      </div>
    </section>
  );
}

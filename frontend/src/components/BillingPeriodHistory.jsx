import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { getBillingVersions } from '../api/client.js';
import { vnd } from '../pages/Pricing.jsx';

export default function BillingPeriodHistory({ baseUrl, month, onClose }) {
  const [before, setBefore] = useState(null);
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true });
    getBillingVersions(baseUrl, month, before, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setState({ data });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setState({ error: error.message });
      });
    return () => controller.abort();
  }, [baseUrl, month, before]);
  return (
    <Modal
      title={`Lịch sử đối chiếu · ${month.split('-').reverse().join('/')}`}
      onClose={onClose}
      wide
    >
      <div className="billing-dialog">
        <p className="billing-muted">
          Mỗi bản giữ số liệu tại lúc đối chiếu. Dữ liệu ghi muộn tạo bản mới, không xóa bản trước.
        </p>
        {state.loading && <p role="status">Đang đọc lịch sử đối chiếu…</p>}
        {state.error && (
          <p className="banner error" role="alert">
            {state.error}
          </p>
        )}
        {state.data?.items.map((row) => (
          <article className="billing-period-version" key={row.revision}>
            <div className="billing-statistics-heading">
              <h3>Bản {row.revision}</h3>
              {row.latest && <span className="admin-tag">Hiện tại</span>}
            </div>
            <p className="billing-muted">
              {new Date(row.as_of).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
              {' · '}
              {row.settlement_status === 'reconciled' ? 'Đã đối chiếu' : 'Đang đối chiếu'}
            </p>
            <dl className="billing-details">
              <div>
                <dt>Phí lưu trữ</dt>
                <dd>{vnd(row.storage_vnd)}</dd>
              </div>
              <div>
                <dt>Phí quản trị</dt>
                <dd>{vnd(row.management_vnd)}</dd>
              </div>
              <div>
                <dt>Tổng chi phí dự kiến</dt>
                <dd>
                  <strong>{vnd(row.total_vnd)}</strong>
                </dd>
              </div>
              <div>
                <dt>Lượt OCR</dt>
                <dd>{row.processing?.ocr_runs ?? 0}</dd>
              </div>
            </dl>
          </article>
        ))}
        {state.data && !state.data.items.length && <p>Chưa có bản đối chiếu cho kỳ này.</p>}
        <div className="billing-toolbar">
          {before != null && (
            <button className="button secondary" onClick={() => setBefore(null)}>
              Về bản mới nhất
            </button>
          )}
          {state.data?.next_before && (
            <button className="button secondary" onClick={() => setBefore(state.data.next_before)}>
              Xem các bản cũ hơn
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

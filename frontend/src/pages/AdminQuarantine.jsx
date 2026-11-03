import { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useAuth } from '../auth/Auth.jsx';
import { getFileContent, listQuarantine } from '../api/client.js';
import { formatBytes } from '../utils/files.js';
import { saveFile } from '../utils/saveFile.js';
import '../admin-quarantine.css';

export default function AdminQuarantine() {
  const { session } = useAuth();
  const [state, setState] = useState({ items: [], cursor: null, loading: true, error: '' });
  const [page, setPage] = useState(null);
  const [revision, refresh] = useState(0);
  const [downloading, setDownloading] = useState(null);
  const download = useRef(null);
  const isAdmin = session.user.role === 'admin';
  useEffect(() => {
    if (!isAdmin) return;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: '' }));
    listQuarantine(session.baseUrl, { cursor: page, signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted)
          setState((s) => ({
            items: page ? [...s.items, ...result.items] : result.items,
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
  }, [page, revision, isAdmin, session.baseUrl]);
  useEffect(() => () => download.current?.abort(), []);

  async function read(item) {
    if (download.current) return;
    const controller = new AbortController();
    download.current = controller;
    setDownloading(item.id);
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
      if (!controller.signal.aborted) setState((s) => ({ ...s, error: e.message }));
    } finally {
      download.current = null;
      if (!controller.signal.aborted) setDownloading(null);
    }
  }

  if (!isAdmin)
    return (
      <section className="empty-state">
        <ShieldAlert size={34} />
        <h2>Bạn không có quyền quản trị</h2>
        <p>Chỉ quản trị viên mới được xem khu vực cách ly của hệ thống.</p>
      </section>
    );
  return (
    <section className="admin-quarantine">
      <div className="admin-summary">
        <span className="admin-summary-icon">
          <ShieldCheck size={27} />
        </span>
        <div>
          <span className="eyebrow">QUẢN TRỊ HỆ THỐNG</span>
          <h2>Khu vực cách ly</h2>
          <p>
            Kiểm tra tệp cần chú ý của các tài khoản. Mỗi lần đọc bản cách ly đều được ghi vào lịch
            sử của tệp.
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
          <RefreshCw size={16} /> Làm mới
        </button>
      </div>
      {state.error && (
        <p className="banner warning" role="alert">
          {state.error}
        </p>
      )}
      <div className="admin-file-list">
        <table>
          <thead>
            <tr>
              <th>Tệp</th>
              <th>Chủ sở hữu</th>
              <th>Trạng thái</th>
              <th>Kích thước</th>
              <th>
                <span className="visually-hidden">Thao tác</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {state.items.map((item) => (
              <tr key={`${item.owner_id}:${item.id}`}>
                <td>
                  <strong>{item.display_name || item.original_name}</strong>
                  <small>
                    {item.quarantined_at
                      ? new Date(item.quarantined_at).toLocaleString('vi-VN')
                      : 'Đang xử lý cách ly'}
                  </small>
                </td>
                <td>{item.owner_name}</td>
                <td>
                  <span className="admin-status">
                    {item.scan_status === 'quarantined'
                      ? 'Đã cách ly'
                      : item.scan_status === 'quarantine_delete_failed'
                        ? 'Chưa xóa được nguồn'
                        : 'Phát hiện nhạy cảm'}
                  </span>
                </td>
                <td>{formatBytes(item.size_bytes)}</td>
                <td>
                  <button
                    className="button secondary"
                    disabled={!item.can_read || Boolean(downloading)}
                    onClick={() => read(item)}
                  >
                    <Download size={15} />
                    {downloading === item.id ? 'Đang đọc…' : 'Tải bản cách ly'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!state.loading && !state.error && !state.items.length && (
          <div className="empty-state">
            <ShieldCheck size={34} />
            <h3>Chưa có tệp cách ly</h3>
            <p>Các tệp cần kiểm tra sẽ xuất hiện tại đây.</p>
          </div>
        )}
      </div>
      {state.loading && <p role="status">Đang đọc danh sách cách ly…</p>}
      {state.cursor && (
        <button
          className="button secondary"
          disabled={state.loading}
          onClick={() => setPage(state.cursor)}
        >
          Xem thêm
        </button>
      )}
    </section>
  );
}

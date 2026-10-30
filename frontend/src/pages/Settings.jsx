import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, Monitor, Moon, Plug, Sun } from 'lucide-react';
import { useWorkspace, defaultPreferences } from '../state/Workspace.jsx';
import { checkHealth, validateApiBaseUrl } from '../api/client.js';
import { formatBytes, UPLOAD_LIMIT } from '../utils/files.js';
import { themeLabels } from '../components/Layout.jsx';
import { sortLabels } from '../components/FileBrowser.jsx';

export default function Settings() {
  const w = useWorkspace();
  const [draft, setDraft] = useState({
    mode: w.preferences.mode,
    baseUrl: w.preferences.baseUrl,
  });
  const [result, setResult] = useState(w.health);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(null);
  const requestId = useRef(0);
  useEffect(() => {
    // A quick switch in the page header also updates an already-open settings form.
    requestId.current++;
    request.current?.abort();
    setDraft({ mode: w.preferences.mode, baseUrl: w.preferences.baseUrl });
    setResult(w.health);
    setChecking(false);
    setError('');
  }, [w.preferences.mode, w.preferences.baseUrl]);
  useEffect(
    () => () => {
      requestId.current++;
      request.current?.abort();
    },
    [],
  );
  function change(patch) {
    requestId.current++;
    request.current?.abort();
    setChecking(false);
    setResult(null);
    setError('');
    setDraft((current) => ({ ...current, ...patch }));
  }
  async function inspect() {
    request.current?.abort();
    const id = ++requestId.current;
    const controller = new AbortController();
    request.current = controller;
    setChecking(true);
    setError('');
    setResult(null);
    try {
      const data = await checkHealth(draft.baseUrl, {
        signal: controller.signal,
      });
      if (id !== requestId.current) return;
      setResult(data);
      if (w.preferences.mode === 'api' && w.preferences.baseUrl === data.baseUrl) w.setHealth(data);
    } catch (err) {
      if (id === requestId.current && !controller.signal.aborted)
        setError(
          err.message === 'Failed to fetch'
            ? 'Không kết nối được — kiểm tra địa chỉ, máy chủ và CORS.'
            : err.message,
        );
    } finally {
      if (id === requestId.current) setChecking(false);
    }
  }
  function save(event) {
    event.preventDefault();
    try {
      const value = {
        ...draft,
        baseUrl: draft.mode === 'api' ? validateApiBaseUrl(draft.baseUrl) : draft.baseUrl,
      };
      if (w.saveConnection(value)) {
        setDraft(value);
        if (result?.baseUrl === value.baseUrl && value.mode === 'api') w.setHealth(result);
        setError('');
      }
    } catch (err) {
      setError(
        err.message === 'Invalid URL'
          ? 'Địa chỉ không hợp lệ — ví dụ http://localhost:8000'
          : err.message,
      );
    }
  }
  function reset() {
    if (
      !w.saveConnection({
        mode: defaultPreferences.mode,
        baseUrl: defaultPreferences.baseUrl,
      })
    )
      return;
    requestId.current++;
    request.current?.abort();
    w.setPreferences({ ...defaultPreferences });
    setDraft({
      mode: defaultPreferences.mode,
      baseUrl: defaultPreferences.baseUrl,
    });
    setResult(null);
    setError('');
    setChecking(false);
    w.notify('Đã khôi phục tùy chọn mặc định. Danh sách tệp vẫn được giữ.');
  }
  return (
    <div className="settings-layout">
      <section className="settings-section">
        <div className="section-title">
          <span className="section-icon">
            <Monitor size={22} />
          </span>
          <div>
            <h2>Giao diện của bạn</h2>
            <p>Cùng một không gian, theo cách bạn thấy dễ chịu nhất.</p>
          </div>
        </div>
        <fieldset>
          <legend>Chủ đề giao diện</legend>
          <div className="theme-options">
            {Object.entries(themeLabels).map(([value, label]) => {
              const Icon = { light: Sun, dark: Moon, system: Monitor }[value];
              return (
                <label
                  className={`theme-option ${w.preferences.theme === value ? 'selected' : ''}`}
                  key={value}
                >
                  <input
                    type="radio"
                    name="theme"
                    value={value}
                    checked={w.preferences.theme === value}
                    onChange={() => w.setPreferences((p) => ({ ...p, theme: value }))}
                  />
                  <Icon size={24} />
                  <strong>{label}</strong>
                  <span>
                    {value === 'light'
                      ? 'Sáng nhẹ, pastel'
                      : value === 'dark'
                        ? 'Tím than, dịu mắt'
                        : 'Đổi cùng thiết bị'}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className="preference-fields">
          <label>
            Hiển thị tệp
            <select
              value={w.preferences.view}
              onChange={(event) => w.setPreferences((p) => ({ ...p, view: event.target.value }))}
            >
              <option value="list">Danh sách</option>
              <option value="grid">Lưới</option>
            </select>
          </label>
          <label>
            Sắp xếp mặc định
            <select
              value={w.preferences.sort}
              onChange={(event) => w.setPreferences((p) => ({ ...p, sort: event.target.value }))}
            >
              {Object.entries(sortLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>
      <section className="settings-section">
        <div className="section-title">
          <span className="section-icon">
            <Plug size={22} />
          </span>
          <div>
            <h2>Kết nối lưu trữ</h2>
            <p>Chọn trải nghiệm giao diện hoặc gửi tệp thật đến máy chủ.</p>
          </div>
        </div>
        <form onSubmit={save}>
          <fieldset disabled={w.busy || w.duplicates.length > 0}>
            <legend>Chế độ tải tệp</legend>
            <label className={`mode-option ${draft.mode === 'demo' ? 'selected' : ''}`}>
              <input
                type="radio"
                name="mode"
                checked={draft.mode === 'demo'}
                onChange={() => change({ mode: 'demo' })}
              />
              <span>
                <strong>Trải nghiệm giao diện</strong>
                <small>
                  Mô phỏng tiến độ, không gửi nội dung tệp. Danh sách mất khi tải lại trang.
                </small>
              </span>
            </label>
            <label className={`mode-option ${draft.mode === 'api' ? 'selected' : ''}`}>
              <input
                type="radio"
                name="mode"
                checked={draft.mode === 'api'}
                onChange={() => change({ mode: 'api' })}
              />
              <span>
                <strong>Lưu trữ thật</strong>
                <small>
                  Gửi tệp đến máy chủ. Nơi lưu local hoặc Amazon S3 do máy chủ quyết định.
                </small>
              </span>
            </label>
            {draft.mode === 'api' && (
              <div className="connection-fields">
                <label htmlFor="backend-url">Địa chỉ máy chủ</label>
                <div className="connection-input">
                  <input
                    id="backend-url"
                    type="url"
                    value={draft.baseUrl}
                    required
                    placeholder="http://localhost:8000"
                    onChange={(event) => change({ baseUrl: event.target.value })}
                  />
                  <button
                    type="button"
                    className="button secondary"
                    disabled={checking}
                    onClick={inspect}
                  >
                    {checking ? <LoaderCircle size={16} className="spin" /> : <Plug size={16} />}
                    {checking ? 'Đang kiểm tra…' : 'Kiểm tra kết nối'}
                  </button>
                </div>
                <small>
                  Chỉ nhập địa chỉ gốc của máy chủ bạn tin cậy, không thêm /docs hoặc /upload.
                </small>
                <div className="connection-result" role="status">
                  {checking ? (
                    'Đang chờ máy chủ phản hồi…'
                  ) : result ? (
                    <>
                      <strong>
                        <Check size={16} />
                        Máy chủ phản hồi
                      </strong>
                      <p>
                        Nơi lưu:{' '}
                        {result.storage === 'local'
                          ? 'Ổ đĩa máy chạy API'
                          : result.storage === 's3'
                            ? 'Amazon S3'
                            : 'Chưa cấu hình'}{' '}
                        · Giới hạn mỗi tệp:{' '}
                        {formatBytes(Math.min(UPLOAD_LIMIT, result.max_file_size_bytes))}
                      </p>
                      <small>
                        Kiểm tra lúc {new Date(result.checkedAt).toLocaleTimeString('vi-VN')}.{' '}
                        {result.storage_configured
                          ? 'Đã chọn bộ lưu trữ.'
                          : 'Bộ lưu trữ chưa sẵn sàng.'}{' '}
                        Kết quả này chưa chứng minh tệp được tải lên thành công.
                      </small>
                    </>
                  ) : (
                    'Chưa có kết quả kiểm tra cho địa chỉ này.'
                  )}
                </div>
              </div>
            )}
          </fieldset>
          {error && (
            <p className="banner error" role="alert">
              {error}
            </p>
          )}
          {w.busy && (
            <p className="banner warning">Chờ hoặc hủy tệp đang tải trước khi đổi kết nối.</p>
          )}
          <div className="settings-footer">
            <span>Ghi nhớ trên trình duyệt này</span>
            <button
              type="submit"
              className="button primary"
              disabled={w.busy || w.duplicates.length > 0}
            >
              <Check size={16} />
              Lưu kết nối
            </button>
          </div>
        </form>
      </section>
      <section className="settings-section reset-section">
        <div>
          <h2>Khôi phục tùy chọn</h2>
          <p>Đặt lại giao diện và kết nối. Không xóa danh sách tệp hiện tại.</p>
        </div>
        <button
          className="button secondary"
          disabled={w.busy || w.duplicates.length > 0}
          onClick={reset}
        >
          Khôi phục mặc định
        </button>
      </section>
    </div>
  );
}

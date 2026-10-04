import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Check, ChevronDown, ChevronRight, CircleHelp, Clock3, Cloud, CloudUpload, FileImage, FileSpreadsheet, FileText, FolderClosed, HardDrive, Layers2, LayoutGrid, List, Menu, Plug, Search, Star, X } from 'lucide-react';
import UploadButton from '../components/UploadButton.jsx';
import FileList from '../components/FileList.jsx';
import FileIcon from '../components/FileIcon.jsx';
import Modal from '../components/Modal.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { demoUpload, uploadFile, validateApiBaseUrl } from '../api/client.js';
import { fileCategory, formatBytes, normalizedSearch, validateFile } from '../utils/files.js';

const configuredSize = Number(import.meta.env.VITE_MAX_FILE_SIZE_MB || 100);
const maxSizeMB = Number.isFinite(configuredSize) && configuredSize > 0 ? configuredSize : 100;
const initialConfig = {
  mode: import.meta.env.VITE_UPLOAD_MODE === 'api' ? 'api' : 'demo',
  baseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000',
};
const categories = [
  { id: 'document', title: 'Tài liệu', icon: FileText, hint: 'PDF, Word, văn bản' },
  { id: 'image', title: 'Hình ảnh', icon: FileImage, hint: 'JPG, PNG, SVG' },
  { id: 'sheet', title: 'Bảng tính', icon: FileSpreadsheet, hint: 'Excel, CSV' },
  { id: 'other', title: 'Tệp khác', icon: FolderClosed, hint: 'Video, ZIP và hơn nữa' },
];
const sections = { all: 'Tệp của tôi', recent: 'Gần đây', starred: 'Đã đánh dấu' };

function ConnectionSettings({ config, onSave, onClose, busy }) {
  const [draft, setDraft] = useState(config);
  const [error, setError] = useState('');
  function save(event) {
    event.preventDefault();
    try {
      onSave({ ...draft, baseUrl: draft.mode === 'api' ? validateApiBaseUrl(draft.baseUrl) : draft.baseUrl });
    } catch (err) { setError(err.message === 'Invalid URL' ? 'Địa chỉ chưa hợp lệ — ví dụ: http://localhost:8000' : err.message); }
  }
  return <Modal title="Kết nối lưu trữ" onClose={onClose}>
    <p className="modal-intro">Chọn cách bạn muốn tải tệp lên</p>
    <form onSubmit={save}>
      <label className={`mode-option ${draft.mode === 'demo' ? 'selected' : ''}`}><input type="radio" name="mode" value="demo" checked={draft.mode === 'demo'} onChange={() => setDraft({ ...draft, mode: 'demo' })} /><span><strong>Trải nghiệm giao diện</strong><small>Mô phỏng tiến độ — tệp chỉ ở trong bộ nhớ trình duyệt và mất khi tải lại trang</small></span></label>
      <label className={`mode-option ${draft.mode === 'api' ? 'selected' : ''}`}><input type="radio" name="mode" value="api" checked={draft.mode === 'api'} onChange={() => setDraft({ ...draft, mode: 'api' })} /><span><strong>Kết nối API (local / S3)</strong><small>Gửi tệp thật đến backend. Backend local lưu trên máy chạy API; S3 cần adapter AWS của nhóm</small></span></label>
      {draft.mode === 'api' && <div className="form-field"><label htmlFor="api-url">Địa chỉ backend</label><input id="api-url" type="url" placeholder="http://localhost:8000" value={draft.baseUrl} onChange={(e) => { setDraft({ ...draft, baseUrl: e.target.value }); setError(''); }} required /><small>Frontend gọi POST /upload với trường multipart “file” — chỉ nhập địa chỉ máy chủ bạn tin cậy</small></div>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {busy && <p className="form-hint">Đợi các tệp tải xong hoặc hủy tải trước khi đổi kết nối</p>}
      <div className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>Để sau</button><button type="submit" className="button primary" disabled={busy}><Check size={16} />Lưu cấu hình</button></div>
    </form>
  </Modal>;
}

export default function Drive() {
  const [files, setFiles] = useState([]);
  const [config, setConfig] = useState(initialConfig);
  const [section, setSection] = useState('all');
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [view, setView] = useState('list');
  const [sort, setSort] = useState('newest');
  const [modal, setModal] = useState(null);
  const [inspectedId, setInspectedId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notice, setNotice] = useState(null);
  const inputRef = useRef(null);
  const active = useRef(new Map());
  const queue = useRef([]);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; queue.current = []; active.current.forEach((controller) => controller.abort()); active.current.clear(); };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timeout);
  }, [notice]);
  const busy = files.some((file) => ['queued', 'uploading'].includes(file.status));
  useEffect(() => {
    if (!busy) return;
    const onUnload = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [busy]);

  const update = (id, patch) => { if (mounted.current) setFiles((current) => current.map((file) => file.id === id ? { ...file, ...patch } : file)); };

  async function processQueue() {
    if (active.current.size || !queue.current.length || !mounted.current) return;
    const { item, connection } = queue.current.shift();
    const controller = new AbortController();
    active.current.set(item.id, controller);
    update(item.id, { status: 'uploading', error: null, progress: 0 });
    try {
      const result = await (connection.mode === 'demo' ? demoUpload : uploadFile)(item.original, {
        baseUrl: connection.baseUrl, signal: controller.signal, onProgress: (progress) => update(item.id, { progress }),
      });
      update(item.id, { status: 'success', progress: 100, remoteId: result.id, key: result.key, storage: result.storage, scanStatus: result.scanStatus });
    } catch (error) {
      update(item.id, { status: error.name === 'AbortError' ? 'cancelled' : 'error', error: error.name === 'AbortError' ? null : error.message });
    } finally { active.current.delete(item.id); processQueue(); }
  }

  function addFiles(selected) {
    if (!selected.length) return;
    if (config.mode === 'api') {
      try { validateApiBaseUrl(config.baseUrl); } catch { setModal('settings'); setNotice('Vui lòng cấu hình địa chỉ backend trước khi tải lên'); return; }
    }
    const next = selected.map((original) => {
      const error = validateFile(original, maxSizeMB * 1024 * 1024);
      return { id: crypto.randomUUID(), name: original.name, size: original.size, type: original.type, original, mode: config.mode, connection: { ...config }, createdAt: Date.now(), status: error ? 'error' : 'queued', validationError: Boolean(error), error, progress: 0, starred: false };
    });
    setFiles((current) => [...next, ...current]);
    queue.current.push(...next.filter((item) => !item.error).map((item) => ({ item, connection: { ...config } })));
    setSection('all'); setCategory('all'); setSearch('');
    processQueue();
  }

  function cancel(id) {
    queue.current = queue.current.filter(({ item }) => item.id !== id);
    active.current.get(id)?.abort();
    update(id, { status: 'cancelled', error: null });
  }
  function retry(id) {
    const item = files.find((file) => file.id === id);
    if (!item || !['error', 'cancelled'].includes(item.status) || active.current.has(id) || queue.current.some(({ item: queued }) => queued.id === id)) return;
    const error = validateFile(item.original, maxSizeMB * 1024 * 1024);
    if (error) { setNotice(error); return; }
    update(id, { status: 'queued', error: null, progress: 0 });
    queue.current.push({ item, connection: item.connection });
    processQueue();
  }
  function changeSection(next) { setSection(next); setCategory('all'); setSidebarOpen(false); }
  const complete = files.filter((file) => file.status === 'success');
  const totalBytes = complete.reduce((sum, file) => sum + file.size, 0);
  const visibleFiles = useMemo(() => files.filter((file) =>
    (section !== 'starred' || file.starred) &&
    (section !== 'recent' || Date.now() - file.createdAt < 24 * 60 * 60 * 1000) &&
    (category === 'all' || fileCategory(file) === category) &&
    normalizedSearch(file.name).includes(normalizedSearch(search)),
  ).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'vi') : sort === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt), [files, section, category, search, sort]);
  const inspected = files.find((file) => file.id === inspectedId);
  const activeCount = files.filter((file) => ['uploading', 'queued'].includes(file.status)).length;

  return <div className="app-shell">
    {sidebarOpen && <button className="sidebar-backdrop" aria-label="Đóng menu" onClick={() => setSidebarOpen(false)} />}
    <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
      <a href="#" className="brand" aria-label="Mây4u — trang chính" onClick={(e) => { e.preventDefault(); changeSection('all'); setSearch(''); }}><span className="brand-mark"><Layers2 size={25} strokeWidth={1.8} /></span><span className="brand-wordmark">Mây4u</span></a>
      <div className="workspace-label"><span className="workspace-icon"><Cloud size={18} /></span><span>Không gian cá nhân<small>Lưu giữ điều quan trọng</small></span></div>
      <span className="nav-label">KHÔNG GIAN LÀM VIỆC</span>
      <nav aria-label="Điều hướng chính">
        <button className={`nav-item ${section === 'all' ? 'active' : ''}`} onClick={() => changeSection('all')}><HardDrive size={19} /><span>Tệp của tôi</span><span className="nav-count">{files.length}</span></button>
        <button className={`nav-item ${section === 'recent' ? 'active' : ''}`} onClick={() => changeSection('recent')}><Clock3 size={19} /><span>Gần đây</span></button>
        <button className={`nav-item ${section === 'starred' ? 'active' : ''}`} onClick={() => changeSection('starred')}><Star size={19} /><span>Đã đánh dấu</span></button>
      </nav>
      <div className="sidebar-bottom">
        <div className="storage-card"><span className="storage-icon"><CloudUpload size={21} /></span><h3>Một nơi cho mọi tệp</h3><p>Demo API lưu trên máy<br />Sẵn sàng ghép adapter S3</p><button onClick={() => setModal('settings')}>Thiết lập kết nối<ArrowUpRight size={15} /></button></div>
        <button className="nav-item help-link" onClick={() => setModal('help')}><CircleHelp size={19} /><span>Hướng dẫn sử dụng</span><ArrowUpRight size={14} /></button>
        <div className="sidebar-signature"><span className="tiny-dot" />Made for a little more space</div>
      </div>
    </aside>
    <div className="main-shell">
      <header className="topbar">
        <div className="topbar-left"><button className="icon-button mobile-menu" aria-label="Mở menu" onClick={() => setSidebarOpen(true)}><Menu size={21} /></button><div className="breadcrumb"><Cloud size={17} /><span>Không gian</span><ChevronRight size={14} /><strong>{sections[section]}</strong></div></div>
        <div className="topbar-right"><label className="search-field"><Search size={17} /><input aria-label="Tìm kiếm tệp" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm kiếm tệp của bạn" />{search && <button className="icon-button" aria-label="Xóa tìm kiếm" onClick={() => setSearch('')}><X size={14} /></button>}</label><button className="avatar" aria-label="Thông tin không gian cá nhân" onClick={() => setModal('about')}>B</button></div>
      </header>
      <main>
        <div className="page-heading"><div><h1>{section === 'all' ? 'Không gian của bạn' : sections[section]}</h1><p>{section === 'recent' ? 'Những tệp bạn đã thêm trong 24 giờ qua' : section === 'starred' ? 'Giữ những tệp quan trọng luôn trong tầm tay' : 'Tài liệu, hình ảnh và mọi ý tưởng — gọn gàng ở đây'}</p></div><button className={`connection-pill ${config.mode}`} onClick={() => setModal('settings')}><span className="tiny-dot" />{config.mode === 'demo' ? 'Chế độ trải nghiệm' : 'Chế độ API'}<ChevronDown size={14} /></button></div>
        <UploadButton onFiles={addFiles} maxSizeMB={maxSizeMB} inputRef={inputRef} />
        <div className="upload-note"><span>{config.mode === 'demo' ? <><span className="note-dot" />Bạn đang trải nghiệm — tệp chưa được gửi đến API</> : <><Plug size={14} />Tệp gửi thật đến API — nhãn từng tệp cho biết local hay S3</>}</span><button onClick={() => setModal('settings')}>{config.mode === 'demo' ? 'Kết nối API' : 'Xem kết nối'}<ArrowRight size={14} /></button></div>
        <section className="categories" aria-label="Lọc theo loại tệp">{categories.map(({ id, title, icon: Icon, hint }) => {
          const items = complete.filter((file) => fileCategory(file) === id);
          return <button key={id} className={`category-card ${category === id ? 'selected' : ''}`} aria-pressed={category === id} onClick={() => setCategory(category === id ? 'all' : id)}><span className="category-icon"><Icon size={22} strokeWidth={1.5} /></span><div className="category-copy"><h3>{title}</h3><span>{items.length} tệp<span className="category-separator">·</span>{formatBytes(items.reduce((sum, item) => sum + item.size, 0))}</span></div><ArrowUpRight className="category-arrow" size={16} /><span className="category-hint">{hint}</span></button>;
        })}</section>
        <section className="files-section" aria-labelledby="files-heading">
          <div className="files-heading"><div><h2 id="files-heading">{section === 'starred' ? 'Tệp đã đánh dấu' : section === 'recent' ? 'Tệp gần đây' : 'Tất cả tệp'}<span className="count-badge">{visibleFiles.length}</span></h2><p>Các tệp trong phiên làm việc này</p></div><div className="file-toolbar"><label className="sort-control"><span className="visually-hidden">Sắp xếp tệp</span><select aria-label="Sắp xếp tệp" value={sort} onChange={(e) => setSort(e.target.value)}><option value="newest">Mới nhất trước</option><option value="oldest">Cũ nhất trước</option><option value="name">Tên A → Z</option></select><ChevronDown size={14} /></label><div className="view-switch" aria-label="Kiểu hiển thị"><button className={view === 'list' ? 'active' : ''} aria-label="Dạng danh sách" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={18} /></button><button className={view === 'grid' ? 'active' : ''} aria-label="Dạng lưới" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><LayoutGrid size={16} /></button></div></div></div>
          {category !== 'all' && <div className="active-filter"><span>{categories.find((item) => item.id === category)?.title}</span><button aria-label="Bỏ lọc loại tệp" onClick={() => setCategory('all')}><X size={14} /></button></div>}
          <FileList files={visibleFiles} view={view} hasFiles={files.length > 0} filtered={Boolean(search || category !== 'all' || section === 'starred')} onChoose={() => inputRef.current.click()} sort={sort} onSort={setSort} onStar={(id) => setFiles((current) => current.map((file) => file.id === id ? { ...file, starred: !file.starred } : file))} onInspect={(id) => { setInspectedId(id); setModal('detail'); }} onCancel={cancel} onRetry={retry} />
          <div className="files-footer"><span>{complete.length} tệp hoàn tất<span className="footer-dot">·</span>{formatBytes(totalBytes)}</span><span><span className="tiny-dot" />{activeCount ? `${activeCount} tệp đang tải hoặc chờ` : 'Sẵn sàng cho ý tưởng tiếp theo'}</span></div>
        </section>
        <footer className="page-footer"><span>Không gian nhỏ, những điều lớn</span><span><span className="footer-wordmark">Mây4u</span><span className="footer-tagline"> cloud storage</span></span></footer>
      </main>
    </div>
    <div className="sr-live" aria-live="polite">{busy ? `${activeCount} tệp đang tải hoặc chờ` : files.length ? `${complete.length} tệp hoàn tất` : ''}</div>
    {notice && <div className="toast" role="status"><span>{notice}</span><button className="icon-button" aria-label="Đóng thông báo" onClick={() => setNotice(null)}><X size={17} /></button></div>}
    {modal === 'settings' && <ConnectionSettings config={config} busy={busy} onClose={() => setModal(null)} onSave={(value) => { setConfig(value); setModal(null); setNotice(value.mode === 'demo' ? 'Đã bật chế độ trải nghiệm' : 'Đã lưu địa chỉ API — kết nối sẽ được kiểm tra khi tải tệp'); }} />}
    {modal === 'help' && <Modal title="Bắt đầu cùng Mây4u" onClose={() => setModal(null)}><div className="help-steps"><div><span>01</span><p><strong>Chọn cách lưu trữ</strong>Dùng chế độ trải nghiệm hoặc kết nối backend của bạn trong “Kết nối lưu trữ”</p></div><div><span>02</span><p><strong>Thêm tệp của bạn</strong>Kéo thả hoặc chọn nhiều tệp, tối đa {maxSizeMB} MB mỗi tệp — theo dõi tiến độ và thử lại nếu có lỗi</p></div><div><span>03</span><p><strong>Tìm lại thật dễ dàng</strong>Tìm theo tên, lọc loại tệp hoặc đánh dấu tệp quan trọng trong phiên làm việc</p></div></div><div className="info-box">Hiện hỗ trợ upload — danh sách chỉ nằm trong phiên hiện tại; quét dữ liệu nhạy cảm, mã hóa và phân quyền chưa được tích hợp</div></Modal>}
    {modal === 'about' && <Modal title="Không gian cá nhân" onClose={() => setModal(null)}><p className="modal-intro">Đây là không gian làm việc trong trình duyệt của bạn — phiên bản này chưa có tài khoản đăng nhập</p><div className="about-stats"><span><strong>{complete.length}</strong>Tệp hoàn tất</span><span><strong>{formatBytes(totalBytes)}</strong>Dung lượng trong phiên</span></div><p className="form-hint">Tải lại trang sẽ xóa danh sách hiện tại. Tệp đã lưu local vẫn nằm trên máy chạy API; tệp được adapter S3 xác nhận vẫn nằm trên S3</p></Modal>}
    {modal === 'detail' && inspected && <Modal title="Thông tin tệp" onClose={() => setModal(null)}>
      <div className="detail-title"><FileIcon file={inspected} large /><h3>{inspected.name}</h3></div>
      <dl className="file-details">
        <div><dt>Trạng thái</dt><dd><StatusBadge status={inspected.status} mode={inspected.mode} progress={inspected.progress} storage={inspected.storage} /></dd></div>
        <div><dt>Kích thước</dt><dd>{formatBytes(inspected.size)}</dd></div>
        <div><dt>Định dạng</dt><dd>{inspected.type || 'Không xác định'}</dd></div>
        <div><dt>Thời gian thêm</dt><dd>{new Date(inspected.createdAt).toLocaleString('vi-VN')}</dd></div>
        <div><dt>Nơi lưu trữ</dt><dd>{inspected.mode === 'demo' ? 'Bộ nhớ trình duyệt (trải nghiệm)' : inspected.status !== 'success' ? 'Chưa được xác nhận' : inspected.storage === 'local' ? 'Local — ổ đĩa máy chạy API (không phải S3)' : inspected.storage === 's3' ? 'Amazon S3 — API đã xác nhận' : 'API xác nhận lưu — chưa khai báo loại lưu trữ'}</dd></div>
        {inspected.key && <div><dt>Object key</dt><dd>{inspected.key}</dd></div>}
        {inspected.remoteId && inspected.mode !== 'demo' && <div><dt>ID máy chủ</dt><dd>{inspected.remoteId}</dd></div>}
        {inspected.mode !== 'demo' && inspected.status === 'success' && <div><dt>Quét dữ liệu</dt><dd>{inspected.scanStatus === 'not_started' ? 'Chưa bắt đầu quét' : 'Chưa tích hợp hiển thị kết quả quét'}</dd></div>}
      </dl>
      {inspected.error && <p className="form-error">{inspected.error}</p>}
      <div className="info-box">{inspected.mode === 'demo' ? 'Tệp này chưa được gửi đến API — chuyển sang chế độ API và chọn lại tệp để tải thật' : inspected.storage === 'local' ? 'Đã ghi nội dung thật trên máy chạy API để demo HTTP. Chưa tích hợp S3, quét PII hoặc mã hóa theo nghiệp vụ' : 'Trạng thái tải lên không xác nhận tệp đã được quét hoặc mã hóa'}</div>
      <div className="modal-footer"><button className="button secondary" disabled={['uploading', 'queued'].includes(inspected.status)} onClick={() => { setFiles((current) => current.filter((file) => file.id !== inspected.id)); setModal(null); setNotice('Đã bỏ khỏi danh sách phiên này — không xóa tệp đã lưu trên backend'); }}>Bỏ khỏi danh sách</button><button className="button primary" onClick={() => setModal(null)}>Đóng</button></div>
    </Modal>}
  </div>;
}

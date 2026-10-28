import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  Bookmark,
  Columns3,
  LayoutGrid,
  List,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useWorkspace } from '../state/Workspace.jsx';
import { canRetry, filterFiles, isBusy, savedFilterValues, sorts } from '../utils/workspace.js';
import { formatBytes } from '../utils/files.js';
import { isAttention, scanStates } from '../utils/processing.js';
import FileList from './FileList.jsx';
import '../file-workspace.css';

export const sortLabels = {
  newest: 'Mới nhất trước',
  oldest: 'Cũ nhất trước',
  name: 'Tên A → Z',
  'name-desc': 'Tên Z → A',
  size: 'Nhỏ nhất trước',
  'size-desc': 'Lớn nhất trước',
};
const statuses = {
  all: 'Mọi trạng thái tải',
  active: 'Đang tải / xử lý',
  success: 'Đã lưu',
  error: 'Lỗi tải lên',
  cancelled: 'Đã hủy',
  unknown: 'Chưa xác nhận lưu',
};
const categories = {
  all: 'Mọi loại tệp',
  document: 'Tài liệu',
  image: 'Hình ảnh',
  sheet: 'Bảng tính',
  other: 'Tệp khác',
};
const sections = { all: 'Tất cả tệp', recent: '24 giờ gần đây', starred: 'Đã đánh dấu' };
const areas = { all: 'Tất cả', normal: 'Khu thường', attention: 'Cần xử lý / Cách ly' };
const dates = {
  all: 'Mọi thời gian',
  today: 'Hôm nay',
  '7d': '7 ngày gần đây',
  '30d': '30 ngày gần đây',
  custom: 'Khoảng ngày…',
};
const PAGE_SIZE = 50;

export default function FileBrowser({ activity = false }) {
  const w = useWorkspace();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [selection, setSelection] = useState({ key: null, ids: new Set() });
  const [now, setNow] = useState(Date.now());
  const [filterName, setFilterName] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const workspaceRef = useRef(null);
  const anchorRef = useRef(null);
  const savedRef = useRef(null);
  const columnsRef = useRef(null);
  const searchRef = useRef(null);
  const source = activity ? w.activityFiles || w.files : w.files;
  const sync = w.sync || { phase: 'idle' };
  const q = params.get('q') || '';
  const status = Object.hasOwn(statuses, params.get('status')) ? params.get('status') : 'all';
  const category = Object.hasOwn(categories, params.get('category'))
    ? params.get('category')
    : 'all';
  const section = Object.hasOwn(sections, params.get('section')) ? params.get('section') : 'all';
  const area = !activity && Object.hasOwn(areas, params.get('area')) ? params.get('area') : 'all';
  const scan = Object.hasOwn(scanStates, params.get('scan')) ? params.get('scan') : 'all';
  const date = Object.hasOwn(dates, params.get('date')) ? params.get('date') : 'all';
  const dateFrom = params.get('dateFrom') || '';
  const dateTo = params.get('dateTo') || '';
  const sort = sorts.includes(params.get('sort')) ? params.get('sort') : w.preferences.sort;
  const scope =
    w.scope || (w.preferences.mode === 'demo' ? 'demo' : `api:${w.preferences.baseUrl}`);
  const saved = w.preferences.savedFilters?.[scope] || [];
  const currentFilters = savedFilterValues({
    q,
    status,
    category,
    section,
    sort,
    area,
    scan,
    date,
    dateFrom,
    dateTo,
  });
  const visible = useMemo(
    () => filterFiles(source, currentFilters, now),
    [source, q, status, category, section, sort, area, scan, date, dateFrom, dateTo, now],
  );
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const requestedPage = Number(params.get('page'));
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, pages) : 1;
  const pageFiles = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const filterKey = JSON.stringify([
    location.pathname,
    q,
    status,
    category,
    section,
    area,
    scan,
    date,
    dateFrom,
    dateTo,
    sort,
    scope,
    page,
  ]);
  if (selection.key !== filterKey) {
    setSelection({ key: filterKey, ids: new Set() });
    anchorRef.current = null;
  }
  const selected = selection.key === filterKey ? selection.ids : new Set();
  const selectedFiles = pageFiles.filter((file) => selected.has(file.id));
  function setSelected(change) {
    setSelection((current) => {
      const ids = current.key === filterKey ? current.ids : new Set();
      return { key: filterKey, ids: typeof change === 'function' ? change(ids) : change };
    });
  }
  useEffect(() => {
    if (location.state?.focusSearch) searchRef.current?.focus();
  }, [location.state]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    function outside(event) {
      for (const ref of [savedRef, columnsRef])
        if (ref.current?.open && !ref.current.contains(event.target)) ref.current.open = false;
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  function change(key, value) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value && value !== 'all') next.set(key, value);
        else next.delete(key);
        if (key === 'date' && value !== 'custom') {
          next.delete('dateFrom');
          next.delete('dateTo');
        }
        if (key !== 'page') next.delete('page');
        return next;
      },
      { replace: key === 'q' },
    );
    if (key === 'sort') w.setPreferences((p) => ({ ...p, sort: value }));
  }
  function choose(id, range = false) {
    const start = pageFiles.findIndex((file) => file.id === anchorRef.current);
    const end = pageFiles.findIndex((file) => file.id === id);
    setSelected((current) => {
      const next = new Set(current);
      const ids =
        range && start >= 0
          ? pageFiles.slice(Math.min(start, end), Math.max(start, end) + 1).map((file) => file.id)
          : [id];
      const adding = !current.has(id);
      for (const value of ids) {
        if (adding) next.add(value);
        else next.delete(value);
      }
      return next;
    });
    anchorRef.current = id;
  }
  function saveFilter(event) {
    event.preventDefault();
    const name = filterName.trim();
    if (!name || saved.length >= 10) return;
    w.setPreferences((p) => ({
      ...p,
      savedFilters: {
        ...p.savedFilters,
        [scope]: [
          ...(p.savedFilters?.[scope] || []),
          { id: crypto.randomUUID(), name: name.slice(0, 60), filters: currentFilters },
        ].slice(0, 10),
      },
    }));
    setFilterName('');
    setSavedMessage(`Đã lưu “${name}”`);
  }
  function loadFilter(item) {
    const values = savedFilterValues(item.filters);
    setParams(
      Object.fromEntries(Object.entries(values).filter(([, value]) => value && value !== 'all')),
    );
    if (sorts.includes(values.sort)) w.setPreferences((p) => ({ ...p, sort: values.sort }));
    savedRef.current.open = false;
    savedRef.current.querySelector('summary').focus();
  }
  function workspaceKeys(event) {
    const target = event.target;
    const editing = target.closest(
      'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, select, [contenteditable=""] , [contenteditable="true"]',
    );
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === 'a' &&
      target.closest('#file-results') &&
      !editing
    ) {
      event.preventDefault();
      setSelected(new Set(pageFiles.map((file) => file.id)));
    }
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const layer = [savedRef.current, columnsRef.current].find((element) => element?.open);
    if (layer) {
      event.preventDefault();
      event.stopPropagation();
      layer.open = false;
      layer.querySelector('summary')?.focus();
      return;
    }
    if (
      !document.querySelector('[role="dialog"], .file-detail-drawer, .file-viewer') &&
      selected.size
    ) {
      event.preventDefault();
      setSelected(new Set());
    }
  }
  const removable = (file) =>
    !isBusy(file) && Boolean(file.original) && (activity || file.mode === 'demo');
  function perform(action) {
    const ids = selectedFiles
      .filter((file) =>
        action === 'cancel' ? isBusy(file) : action === 'retry' ? canRetry(file) : removable(file),
      )
      .map((file) => file.id);
    w[action](ids);
    setSelected(new Set());
  }
  const filtered = Boolean(
    q ||
    category !== 'all' ||
    status !== 'all' ||
    section !== 'all' ||
    scan !== 'all' ||
    date !== 'all',
  );
  const partial =
    !activity &&
    w.preferences.mode === 'api' &&
    ['idle', 'loading', 'partial'].includes(sync.phase);
  const failure = !activity && sync.phase === 'error';
  const serverLibrary = !activity && w.preferences.mode === 'api' && sync.phase !== 'disabled';
  const title = activity ? 'Lịch sử trong phiên' : 'Danh sách tệp';
  const sourceHint =
    activity || !serverLibrary
      ? `Trong phiên hiện tại · ${source.length} tệp`
      : failure && !sync.lastSyncedAt
        ? 'Chưa đọc được thư viện máy chủ'
        : partial
          ? `Đã tải ${sync.loaded ?? source.length} tệp · đang đọc thêm metadata`
          : `Thư viện máy chủ · ${source.length} tệp${sync.lastSyncedAt ? ` · cập nhật ${new Date(sync.lastSyncedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}` : ''}`;
  const attentionCount = source.filter(isAttention).length;
  const chip = (key, label) => (
    <button
      className="filter-chip"
      onClick={() => change(key, 'all')}
      aria-label={`Bỏ lọc ${label}`}
    >
      {label}
      <X size={12} />
    </button>
  );
  return (
    <section
      className="files-section file-workspace"
      ref={workspaceRef}
      onKeyDown={workspaceKeys}
      aria-label={activity ? 'Danh sách hoạt động' : 'Thư viện tệp'}
    >
      {!activity && (
        <div
          className="file-area-tabs"
          role="tablist"
          aria-label="Khu vực tệp"
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            const values = Object.keys(areas),
              current = values.indexOf(area);
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? values.length - 1
                  : (current + (event.key === 'ArrowRight' ? 1 : -1) + values.length) %
                    values.length;
            event.preventDefault();
            change('area', values[next]);
            document.getElementById(`area-${values[next]}`)?.focus();
          }}
        >
          {Object.entries(areas).map(([value, label]) => (
            <button
              key={value}
              id={`area-${value}`}
              role="tab"
              aria-selected={area === value}
              tabIndex={area === value ? 0 : -1}
              aria-controls="file-results"
              onClick={() => change('area', value)}
            >
              {label}
              <span>
                {value === 'all'
                  ? source.length
                  : value === 'attention'
                    ? attentionCount
                    : source.length - attentionCount}
                {partial ? '+' : ''}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="files-heading">
        <div>
          <h2>
            {title}
            <span className="count-badge">
              {visible.length}
              {partial ? '+' : ''}
            </span>
          </h2>
          <p>{sourceHint}</p>
        </div>
        <div className="file-heading-actions">
          <details className="file-control-popover saved-filter-control" ref={savedRef}>
            <summary title="Bộ lọc đã lưu">
              <Bookmark size={17} />
              Bộ lọc đã lưu
            </summary>
            <div className="file-control-panel">
              <strong>Bộ lọc cho kết nối này</strong>
              {!saved.length && <p>Chưa lưu bộ lọc nào.</p>}
              <ul>
                {saved.map((item) => (
                  <li key={item.id}>
                    <button onClick={() => loadFilter(item)}>{item.name}</button>
                    <button
                      className="icon-button"
                      aria-label={`Xóa bộ lọc ${item.name}`}
                      onClick={() => {
                        w.setPreferences((p) => ({
                          ...p,
                          savedFilters: {
                            ...p.savedFilters,
                            [scope]: (p.savedFilters?.[scope] || []).filter(
                              (value) => value.id !== item.id,
                            ),
                          },
                        }));
                        savedRef.current?.querySelector('summary')?.focus({ preventScroll: true });
                        setSavedMessage(`Đã xóa “${item.name}”`);
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </li>
                ))}
              </ul>
              <form onSubmit={saveFilter}>
                <label htmlFor={`saved-filter-name-${activity ? 'activity' : 'library'}`}>
                  Lưu bộ lọc hiện tại
                </label>
                <input
                  id={`saved-filter-name-${activity ? 'activity' : 'library'}`}
                  value={filterName}
                  maxLength={60}
                  placeholder="Tên bộ lọc"
                  onChange={(event) => {
                    setFilterName(event.target.value);
                    setSavedMessage('');
                  }}
                />
                <button
                  className="button secondary"
                  disabled={!filterName.trim() || saved.length >= 10}
                >
                  Lưu bộ lọc
                </button>
              </form>
              <p role="status">
                {savedMessage || `${saved.length}/10 bộ lọc · chỉ lưu trên trình duyệt này`}
              </p>
            </div>
          </details>
          <details className="file-control-popover" ref={columnsRef}>
            <summary title="Tùy chỉnh hiển thị">
              <Columns3 size={17} />
              <span className="visually-hidden">Tùy chỉnh hiển thị</span>
            </summary>
            <div className="file-control-panel">
              <label>
                Mật độ
                <select
                  aria-label="Mật độ hiển thị"
                  value={w.preferences.density || 'comfortable'}
                  onChange={(event) =>
                    w.setPreferences((p) => ({ ...p, density: event.target.value }))
                  }
                >
                  <option value="comfortable">Thoải mái</option>
                  <option value="compact">Gọn</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={w.preferences.showSize !== false}
                  onChange={(event) =>
                    w.setPreferences((p) => ({ ...p, showSize: event.target.checked }))
                  }
                />
                Cột kích thước
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={w.preferences.showDate !== false}
                  onChange={(event) =>
                    w.setPreferences((p) => ({ ...p, showDate: event.target.checked }))
                  }
                />
                Cột thời gian
              </label>
              <button
                className="text-button"
                onClick={() =>
                  w.setPreferences((p) => ({
                    ...p,
                    nameColumnWidth: 320,
                    showSize: true,
                    showDate: true,
                    density: 'comfortable',
                  }))
                }
              >
                Đặt lại hiển thị
              </button>
            </div>
          </details>
          {!activity && w.preferences.mode === 'api' && (
            <button
              className="icon-button"
              aria-label="Làm mới danh sách"
              title="Làm mới danh sách"
              disabled={partial}
              onClick={() => w.refreshFiles?.()}
            >
              <RefreshCw size={17} className={partial ? 'spin' : ''} />
            </button>
          )}
          <div className="view-switch" role="group" aria-label="Kiểu hiển thị">
            <button
              aria-label="Dạng danh sách"
              aria-pressed={w.preferences.view === 'list'}
              onClick={() => w.setPreferences((p) => ({ ...p, view: 'list' }))}
            >
              <List size={18} />
            </button>
            <button
              aria-label="Dạng lưới"
              aria-pressed={w.preferences.view === 'grid'}
              onClick={() => w.setPreferences((p) => ({ ...p, view: 'grid' }))}
            >
              <LayoutGrid size={18} />
            </button>
          </div>
        </div>
      </div>
      <div className="file-toolbar primary-file-toolbar">
        <label className="search-field">
          <Search size={18} />
          <input
            ref={searchRef}
            aria-label="Tìm kiếm tệp"
            placeholder="Tìm tên tệp, có hoặc không dấu…"
            value={q}
            onChange={(event) => change('q', event.target.value)}
          />
          {q && (
            <button
              aria-label="Xóa tìm kiếm"
              className="icon-button"
              onClick={() => change('q', '')}
            >
              <X size={16} />
            </button>
          )}
        </label>
        <select
          aria-label="Loại tệp"
          value={category}
          onChange={(event) => change('category', event.target.value)}
        >
          {Object.entries(categories).map(([v, text]) => (
            <option key={v} value={v}>
              {text}
            </option>
          ))}
        </select>
        <select
          aria-label="Kết quả quét và cách ly"
          value={scan}
          onChange={(event) => change('scan', event.target.value)}
        >
          <option value="all">Mọi kết quả xử lý</option>
          {Object.entries(scanStates).map(([v, state]) => (
            <option key={v} value={v}>
              {state.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Sắp xếp tệp"
          value={sort}
          onChange={(event) => change('sort', event.target.value)}
        >
          {Object.entries(sortLabels).map(([v, text]) => (
            <option key={v} value={v}>
              {text}
            </option>
          ))}
        </select>
      </div>
      <details
        className="extra-file-filters"
        open={section !== 'all' || status !== 'all' || date !== 'all' || undefined}
      >
        <summary>
          <SlidersHorizontal size={14} />
          Bộ lọc thêm
        </summary>
        <div>
          {!activity && (
            <label>
              Nhóm tệp
              <select
                aria-label="Nhóm tệp"
                value={section}
                onChange={(event) => change('section', event.target.value)}
              >
                {Object.entries(sections).map(([v, text]) => (
                  <option
                    key={v}
                    value={v}
                    disabled={v === 'starred' && w.favoritesAvailable === false}
                  >
                    {text}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Tải lên
            <select
              aria-label="Trạng thái tệp"
              value={status}
              onChange={(event) => change('status', event.target.value)}
            >
              {Object.entries(statuses).map(([v, text]) => (
                <option key={v} value={v}>
                  {text}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ngày thêm
            <select
              aria-label="Ngày thêm tệp"
              value={date}
              onChange={(event) => change('date', event.target.value)}
            >
              {Object.entries(dates).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {date === 'custom' && (
            <>
              <label>
                Từ
                <input
                  type="date"
                  aria-label="Từ ngày"
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={(event) => change('dateFrom', event.target.value)}
                />
              </label>
              <label>
                Đến
                <input
                  type="date"
                  aria-label="Đến ngày"
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(event) => change('dateTo', event.target.value)}
                />
              </label>
              {dateFrom && dateTo && dateFrom > dateTo && (
                <p role="alert" className="file-date-error">
                  Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.
                </p>
              )}
            </>
          )}
        </div>
      </details>
      {filtered && (
        <div className="active-filters">
          <span>
            {visible.length}
            {partial ? '+' : ''} kết quả
          </span>
          {q && chip('q', `Tên: ${q}`)}
          {section !== 'all' && chip('section', sections[section])}
          {category !== 'all' && chip('category', categories[category])}
          {status !== 'all' && chip('status', statuses[status])}
          {scan !== 'all' && chip('scan', scanStates[scan].label)}
          {date !== 'all' &&
            chip(
              'date',
              date === 'custom' ? `Ngày: ${dateFrom || '…'} → ${dateTo || '…'}` : dates[date],
            )}
          <button
            className="text-button"
            onClick={() =>
              setParams({
                ...(area !== 'all' ? { area } : {}),
                ...(sort !== w.preferences.sort ? { sort } : {}),
              })
            }
          >
            Xóa bộ lọc
          </button>
        </div>
      )}
      {!activity && sync.phase === 'disabled' && (
        <p className="file-sync-message" role="status">
          Metadata chưa được bật. Chỉ hiển thị tệp trong phiên; tải lại trang không khôi phục danh
          sách.
        </p>
      )}
      {partial && (
        <p className="file-sync-message" role="status">
          <RefreshCw size={14} className="spin" />
          Đang đọc danh sách từ máy chủ. Bộ lọc và số liệu hiện áp dụng cho phần đã tải.
        </p>
      )}
      {failure && (
        <div className="file-sync-message error" role="alert">
          <span>
            {sync.error || 'Chưa đồng bộ được danh sách.'}
            {source.length
              ? ' Dữ liệu đã có vẫn được giữ.'
              : ' Chưa thể xác định thư viện có trống hay không.'}
          </span>
          <button className="text-button" onClick={() => w.refreshFiles?.()}>
            Thử đồng bộ lại
          </button>
        </div>
      )}
      {selectedFiles.length > 0 && (
        <div className="selection-toolbar" aria-label="Thao tác với tệp đã chọn">
          <strong>
            {selectedFiles.length} đã chọn trên trang ·{' '}
            {formatBytes(selectedFiles.reduce((sum, file) => sum + (file.size || 0), 0))}
          </strong>
          <button
            disabled={
              !selectedFiles.some(
                (file) => !file.starPending && (w.canStar ? w.canStar(file) : file.mode === 'demo'),
              )
            }
            title={w.favoritesAvailable === false ? 'Máy chủ chưa hỗ trợ đánh dấu tệp' : undefined}
            onClick={() =>
              w.star(
                selectedFiles
                  .filter(
                    (file) =>
                      !file.starPending && (w.canStar ? w.canStar(file) : file.mode === 'demo'),
                  )
                  .map((f) => f.id),
                !selectedFiles.every((f) => f.starred),
              )
            }
          >
            <Star size={16} />
            {selectedFiles.every((f) => f.starred) ? 'Bỏ đánh dấu' : 'Đánh dấu'}
          </button>
          <button disabled={!selectedFiles.some(isBusy)} onClick={() => perform('cancel')}>
            <X size={16} />
            Hủy tải
          </button>
          <button disabled={!selectedFiles.some(canRetry)} onClick={() => perform('retry')}>
            <RotateCcw size={16} />
            Thử lại upload
          </button>
          {(activity || w.preferences.mode === 'demo') && (
            <button disabled={!selectedFiles.some(removable)} onClick={() => perform('remove')}>
              <Trash2 size={16} />
              Bỏ khỏi danh sách
            </button>
          )}
          <button className="text-button" onClick={() => setSelected(new Set())}>
            Bỏ chọn
          </button>
        </div>
      )}
      <div
        id="file-results"
        role={!activity ? 'tabpanel' : undefined}
        tabIndex={0}
        aria-label={activity ? 'Tệp hoạt động — Ctrl+A chọn trang hiện tại' : undefined}
        aria-labelledby={!activity ? `area-${area}` : undefined}
      >
        {pageFiles.length || (!partial && !failure) ? (
          <FileList
            files={pageFiles}
            view={w.preferences.view}
            selected={selected}
            onSelect={choose}
            onSelectAll={() =>
              setSelected(
                selectedFiles.length === pageFiles.length
                  ? new Set()
                  : new Set(pageFiles.map((file) => file.id)),
              )
            }
            onInspect={(id) => w.inspect?.(id)}
            onOpen={(id) => (w.openFile || w.inspect)?.(id)}
            onPreview={w.preview}
            onDownload={w.download}
            downloadingId={w.downloadingId}
            canStar={w.canStar}
            contentAvailable={w.contentAvailable}
            onStar={(id) => w.star([id])}
            onRetry={(id) => w.retry([id])}
            onCancel={(id) => w.cancel([id])}
            onChoose={() => w.inputRef.current.click()}
            sort={sort}
            onSort={(value) => change('sort', value)}
            density={w.preferences.density}
            nameColumnWidth={w.preferences.nameColumnWidth}
            showSize={w.preferences.showSize}
            showDate={w.preferences.showDate}
            onNameResize={(value) =>
              w.setPreferences((p) => ({
                ...p,
                nameColumnWidth: Math.min(720, Math.max(240, value)),
              }))
            }
            emptyTitle={
              filtered
                ? 'Không có tệp phù hợp'
                : area === 'attention'
                  ? 'Không có tệp cần xử lý'
                  : area === 'normal'
                    ? 'Chưa có tệp trong khu thường'
                    : activity
                      ? 'Chưa có hoạt động tải lên'
                      : 'Không gian đang chờ tệp đầu tiên'
            }
            emptyMessage={
              filtered
                ? 'Thử từ khóa khác hoặc xóa bộ lọc để xem thêm tệp.'
                : area === 'attention'
                  ? 'Tệp bị phát hiện dữ liệu nhạy cảm, lỗi quét hoặc cách ly sẽ xuất hiện ở đây.'
                  : area === 'normal'
                    ? 'Các tệp chưa bắt đầu quét, đang quét hoặc không phát hiện dữ liệu nhạy cảm sẽ xuất hiện tại đây. Khu thường không đồng nghĩa mọi tệp đã an toàn.'
                    : serverLibrary
                      ? 'Thư viện máy chủ chưa có tệp. Bạn có thể chọn hoặc kéo thả tệp để bắt đầu.'
                      : 'Chọn hoặc kéo thả tệp để bắt đầu. Danh sách trong phiên không được khôi phục khi tải lại trang.'
            }
            filtered={filtered || area !== 'all'}
          />
        ) : (
          <div className="file-loading-space" aria-hidden="true" />
        )}
      </div>
      <div className="files-footer">
        <span>
          {visible.length
            ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, visible.length)} / ${visible.length}${partial ? '+' : ''} tệp`
            : '0 tệp đang hiển thị'}
          {partial ? ' · chưa đọc hết' : ''}
        </span>
        {pages > 1 && (
          <div className="file-pagination" aria-label="Phân trang tệp">
            <button
              className="icon-button"
              aria-label="Trang trước"
              disabled={page === 1}
              onClick={() => change('page', String(page - 1))}
            >
              <ChevronLeft size={17} />
            </button>
            <span>
              Trang {page} / {pages}
            </span>
            <button
              className="icon-button"
              aria-label="Trang sau"
              disabled={page === pages}
              onClick={() => change('page', String(page + 1))}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        )}
        <span>
          {activity || w.preferences.mode === 'demo'
            ? 'Bỏ khỏi danh sách không xóa tệp trên máy chủ'
            : 'Dữ liệu từ FastAPI · DynamoDB'}
        </span>
      </div>
    </section>
  );
}

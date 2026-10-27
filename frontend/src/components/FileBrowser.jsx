import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  CloudUpload,
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
import { canRetry, filterFiles, isBusy, sorts } from '../utils/workspace.js';
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
const PAGE_SIZE = 50;

export default function FileBrowser({ activity = false }) {
  const w = useWorkspace();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [selection, setSelection] = useState({ key: null, ids: new Set() });
  const [now, setNow] = useState(Date.now());
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
  const sort = sorts.includes(params.get('sort')) ? params.get('sort') : w.preferences.sort;
  const visible = useMemo(
    () => filterFiles(source, { q, status, category, section, sort, area, scan }, now),
    [source, q, status, category, section, sort, area, scan, now],
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
    page,
  ]);
  if (selection.key !== filterKey) setSelection({ key: filterKey, ids: new Set() });
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
  function change(key, value) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value && value !== 'all') next.set(key, value);
        else next.delete(key);
        if (key !== 'page') next.delete('page');
        return next;
      },
      { replace: key === 'q' },
    );
    if (key === 'sort') w.setPreferences((p) => ({ ...p, sort: value }));
  }
  function choose(id) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
    q || category !== 'all' || status !== 'all' || section !== 'all' || scan !== 'all',
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
        open={section !== 'all' || status !== 'all' || undefined}
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
                  <option key={v} value={v}>
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
          <strong>{selectedFiles.length} đã chọn trên trang</strong>
          <button
            onClick={() =>
              w.star(
                selectedFiles.map((f) => f.id),
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
            onStar={(id) => w.star([id])}
            onRetry={(id) => w.retry([id])}
            onCancel={(id) => w.cancel([id])}
            onChoose={() => w.inputRef.current.click()}
            sort={sort}
            onSort={(value) => change('sort', value)}
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

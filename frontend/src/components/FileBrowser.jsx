import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { LayoutGrid, List, RotateCcw, Search, Star, Trash2, X } from 'lucide-react';
import { useWorkspace } from '../state/Workspace.jsx';
import { canRetry, filterFiles, isBusy, sorts } from '../utils/workspace.js';
import FileList from './FileList.jsx';
import FileDetail from './FileDetail.jsx';

export const sortLabels = {
  newest: 'Mới nhất trước',
  oldest: 'Cũ nhất trước',
  name: 'Tên A → Z',
  'name-desc': 'Tên Z → A',
  size: 'Nhỏ nhất trước',
  'size-desc': 'Lớn nhất trước',
};
const statuses = {
  all: 'Mọi trạng thái',
  active: 'Đang tải / chờ',
  success: 'Hoàn tất',
  error: 'Lỗi',
  cancelled: 'Đã hủy',
};
const categories = {
  all: 'Mọi loại tệp',
  document: 'Tài liệu',
  image: 'Hình ảnh',
  sheet: 'Bảng tính',
  other: 'Tệp khác',
};
const sections = {
  all: 'Tất cả tệp',
  recent: '24 giờ gần đây',
  starred: 'Đã đánh dấu',
};
export default function FileBrowser({ activity = false }) {
  const w = useWorkspace();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [selection, setSelection] = useState({ key: null, ids: new Set() });
  const [inspected, setInspected] = useState(null);
  const [now, setNow] = useState(Date.now());
  const searchRef = useRef(null);
  const q = params.get('q') || '';
  const status = Object.hasOwn(statuses, params.get('status')) ? params.get('status') : 'all';
  const category = Object.hasOwn(categories, params.get('category'))
    ? params.get('category')
    : 'all';
  const section = Object.hasOwn(sections, params.get('section')) ? params.get('section') : 'all';
  const sort = sorts.includes(params.get('sort')) ? params.get('sort') : w.preferences.sort;
  const visible = useMemo(
    () => filterFiles(w.files, { q, status, category, section, sort }, now),
    [w.files, q, status, category, section, sort, now],
  );
  const filterKey = JSON.stringify([location.pathname, q, status, category, section]);
  // Clear before the new result set becomes interactive, rather than in a late effect.
  if (selection.key !== filterKey) setSelection({ key: filterKey, ids: new Set() });
  const selected = selection.key === filterKey ? selection.ids : new Set();
  const selectedFiles = visible.filter((file) => selected.has(file.id));
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
  function perform(action) {
    const ids = selectedFiles
      .filter((file) =>
        action === 'cancel' ? isBusy(file) : action === 'retry' ? canRetry(file) : !isBusy(file),
      )
      .map((file) => file.id);
    w[action](ids);
    setSelected(new Set());
  }
  const filtered = Boolean(q || category !== 'all' || status !== 'all' || section !== 'all');
  return (
    <section className="files-section">
      <div className="files-heading">
        <div>
          <h2>
            {activity ? 'Lịch sử trong phiên' : 'Danh sách tệp'}{' '}
            <span className="count-badge">{visible.length}</span>
          </h2>
          <p>Danh sách trong phiên hiện tại · {w.files.length} tệp</p>
        </div>
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
      <div className="file-toolbar">
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
        {!activity && (
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
        )}
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
      {filtered && (
        <div className="active-filters">
          <span>{visible.length} kết quả</span>
          {q && <span className="filter-chip">Tên: {q}</span>}
          {section !== 'all' && <span className="filter-chip">{sections[section]}</span>}
          {category !== 'all' && <span className="filter-chip">{categories[category]}</span>}
          {status !== 'all' && <span className="filter-chip">{statuses[status]}</span>}
          <button
            className="text-button"
            onClick={() => setParams(sort !== w.preferences.sort ? { sort } : {})}
          >
            Xóa bộ lọc
          </button>
        </div>
      )}
      {selectedFiles.length > 0 && (
        <div className="selection-toolbar" aria-label="Thao tác với tệp đã chọn">
          <strong>{selectedFiles.length} đã chọn</strong>
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
            Thử lại
          </button>
          <button
            disabled={!selectedFiles.some((file) => !isBusy(file))}
            onClick={() => perform('remove')}
          >
            <Trash2 size={16} />
            Bỏ khỏi danh sách
          </button>
          <button className="text-button" onClick={() => setSelected(new Set())}>
            Bỏ chọn
          </button>
        </div>
      )}
      <FileList
        files={visible}
        view={w.preferences.view}
        selected={selected}
        onSelect={choose}
        onSelectAll={() =>
          setSelected(
            selectedFiles.length === visible.length
              ? new Set()
              : new Set(visible.map((file) => file.id)),
          )
        }
        onInspect={setInspected}
        onStar={(id) => w.star([id])}
        onRetry={(id) => w.retry([id])}
        onCancel={(id) => w.cancel([id])}
        onChoose={() => w.inputRef.current.click()}
        emptyTitle={
          filtered
            ? 'Không có tệp phù hợp'
            : activity
              ? 'Chưa có hoạt động tải lên'
              : 'Không gian đang chờ tệp đầu tiên'
        }
        emptyMessage={
          filtered
            ? 'Thử từ khóa khác hoặc xóa bộ lọc để xem thêm tệp.'
            : 'Chọn hoặc kéo thả tệp để bắt đầu. Nếu bạn vừa tải lại trang, danh sách của phiên trước không được khôi phục; tệp đã lưu vẫn có thể còn trên máy chủ.'
        }
        filtered={filtered}
      />
      <div className="files-footer">
        <span>
          {visible.length} / {w.files.length} tệp trong phiên
        </span>
        <span>Bỏ khỏi danh sách không xóa tệp trên máy chủ</span>
      </div>
      {inspected && <FileDetail id={inspected} onClose={() => setInspected(null)} />}
    </section>
  );
}

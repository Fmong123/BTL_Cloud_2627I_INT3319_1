import { useEffect, useRef } from 'react';
import { ArrowDown, ArrowUp, Eye, FolderOpen, RotateCcw, SearchX, Star, X } from 'lucide-react';
import FileIcon from './FileIcon.jsx';
import StatusBadge from './StatusBadge.jsx';
import ScanBadge from './ScanBadge.jsx';
import { formatBytes } from '../utils/files.js';
import { canRetry, isBusy } from '../utils/workspace.js';

function Actions({ file, onStar, onInspect, onRetry, onCancel }) {
  return (
    <div className="file-actions">
      {isBusy(file) && (
        <button
          className="icon-button"
          title="Hủy tải lên"
          aria-label={`Hủy tải ${file.name}`}
          onClick={() => onCancel(file.id)}
        >
          <X size={16} />
        </button>
      )}
      {canRetry(file) && (
        <button
          className="icon-button"
          title="Thử lại upload"
          aria-label={`Thử lại ${file.name}`}
          onClick={() => onRetry(file.id)}
        >
          <RotateCcw size={16} />
        </button>
      )}
      <button
        className={`icon-button ${file.starred ? 'starred' : ''}`}
        title={file.starred ? 'Bỏ đánh dấu' : 'Đánh dấu'}
        aria-label={`${file.starred ? 'Bỏ đánh dấu' : 'Đánh dấu'} ${file.name}`}
        aria-pressed={file.starred}
        onClick={() => onStar(file.id)}
      >
        <Star size={16} fill={file.starred ? 'currentColor' : 'none'} />
      </button>
      <button
        className="icon-button"
        title="Thông tin tệp"
        aria-label={`Thông tin ${file.name}`}
        onClick={() => onInspect(file.id)}
      >
        <Eye size={17} />
      </button>
    </div>
  );
}
function SelectAll({ files, selected, onSelectAll }) {
  const ref = useRef(null);
  const count = files.filter((file) => selected.has(file.id)).length;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = count > 0 && count < files.length;
  }, [count, files.length]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label="Chọn tất cả tệp đang hiển thị"
      checked={count === files.length && files.length > 0}
      onChange={onSelectAll}
    />
  );
}
export default function FileList({
  files,
  view = 'list',
  selected,
  onSelect,
  onSelectAll,
  onChoose,
  emptyTitle = 'Chưa có tệp',
  emptyMessage = 'Tệp bạn thêm sẽ xuất hiện ở đây.',
  filtered = false,
  sort,
  onSort,
  ...actions
}) {
  if (!files.length)
    return (
      <div className="empty-state">
        <span className="empty-icon">
          {filtered ? <SearchX size={30} /> : <FolderOpen size={30} />}
        </span>
        <h3>{emptyTitle}</h3>
        <p>{emptyMessage}</p>
        {!filtered && onChoose && (
          <button className="button secondary" onClick={onChoose}>
            Chọn tệp đầu tiên
          </button>
        )}
      </div>
    );
  const checkbox = (file) =>
    selected && (
      <input
        type="checkbox"
        aria-label={`Chọn ${file.name}`}
        checked={selected.has(file.id)}
        onChange={() => onSelect(file.id)}
      />
    );
  const progress = (file) =>
    file.status === 'uploading' &&
    file.original && (
      <progress max="100" value={file.progress} aria-label={`Tiến độ ${file.name}`} />
    );
  const statuses = (file) => (
    <div className="file-card-statuses">
      <div>
        <span>Tải lên</span>
        <StatusBadge {...file} />
      </div>
      <div>
        <span>Quét / cách ly</span>
        <ScanBadge {...file} />
      </div>
    </div>
  );
  const sortHeader = (label, ascending, descending) => {
    const current = sort === ascending || sort === descending;
    return (
      <th aria-sort={current ? (sort === ascending ? 'ascending' : 'descending') : undefined}>
        {onSort ? (
          <button
            className="column-sort"
            onClick={() => onSort(sort === ascending ? descending : ascending)}
          >
            {label}
            {current && (sort === ascending ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
          </button>
        ) : (
          label
        )}
      </th>
    );
  };
  if (view === 'grid')
    return (
      <>
        <div className="grid-select">
          {selected && (
            <label>
              <SelectAll files={files} selected={selected} onSelectAll={onSelectAll} />
              Chọn tất cả trên trang
            </label>
          )}
        </div>
        <div className="file-grid">
          {files.map((file) => (
            <article
              className={`file-card ${selected?.has(file.id) ? 'selected' : ''}`}
              key={file.id}
            >
              <div className="file-card-top">
                {checkbox(file)}
                <FileIcon file={file} large />
                <Actions file={file} {...actions} />
              </div>
              <button
                className="file-name"
                title={file.name}
                onClick={() => actions.onInspect(file.id)}
              >
                {file.name}
              </button>
              <p className="file-meta">
                {formatBytes(file.size)} · {new Date(file.createdAt).toLocaleDateString('vi-VN')}
              </p>
              {statuses(file)}
              {progress(file)}
              {file.error && <p className="file-error">{file.error}</p>}
              {file.syncError && <p className="file-error">Chưa cập nhật được kết quả</p>}
            </article>
          ))}
        </div>
      </>
    );
  return (
    <div className="table-scroll">
      <table className="file-table processing-table">
        <thead>
          <tr>
            {selected && (
              <th className="checkbox-cell">
                <SelectAll files={files} selected={selected} onSelectAll={onSelectAll} />
              </th>
            )}
            {sortHeader('Tên tệp', 'name', 'name-desc')}
            {sortHeader('Kích thước', 'size', 'size-desc')}
            {sortHeader('Thời gian thêm', 'oldest', 'newest')}
            <th>Tải lên</th>
            <th>Quét / cách ly</th>
            <th>
              <span className="visually-hidden">Thao tác</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {files.map((file) => (
            <tr key={file.id} className={selected?.has(file.id) ? 'selected' : ''}>
              {selected && <td className="checkbox-cell">{checkbox(file)}</td>}
              <td>
                <div className="file-title-cell">
                  <FileIcon file={file} />
                  <div className="file-title-text">
                    <button
                      className="file-name"
                      title={file.name}
                      onClick={() => actions.onInspect(file.id)}
                    >
                      {file.name}
                    </button>
                    {progress(file)}
                    {file.error && <span className="file-error">{file.error}</span>}
                    {file.syncError && (
                      <span className="file-error">Chưa cập nhật được kết quả</span>
                    )}
                  </div>
                </div>
              </td>
              <td className="nowrap">{formatBytes(file.size)}</td>
              <td className="nowrap">
                {new Date(file.createdAt).toLocaleTimeString('vi-VN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                <span className="cell-date">
                  {new Date(file.createdAt).toLocaleDateString('vi-VN')}
                </span>
              </td>
              <td>
                <StatusBadge {...file} />
              </td>
              <td>
                <ScanBadge {...file} />
              </td>
              <td>
                <Actions file={file} {...actions} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

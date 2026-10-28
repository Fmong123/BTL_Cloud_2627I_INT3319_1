import { useEffect, useRef } from 'react';
import { ArrowDown, ArrowUp, FolderOpen, SearchX } from 'lucide-react';
import FileIcon from './FileIcon.jsx';
import StatusBadge from './StatusBadge.jsx';
import ScanBadge from './ScanBadge.jsx';
import { formatBytes } from '../utils/files.js';
import FileActions from './FileActions.jsx';

function SelectAll({ files, selected, onSelectAll }) {
  const ref = useRef(null);
  const count = files.filter((file) => selected.has(file.id)).length;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = count > 0 && count < files.length;
  }, [count, files.length]);
  return (
    <label className="file-checkbox-hit">
      <input
        ref={ref}
        type="checkbox"
        aria-label="Chọn tất cả tệp đang hiển thị"
        checked={count === files.length && files.length > 0}
        onChange={onSelectAll}
      />
    </label>
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
  density = 'comfortable',
  nameColumnWidth = 320,
  showSize = true,
  showDate = true,
  onNameResize,
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
      <label className="file-checkbox-hit">
        <input
          type="checkbox"
          aria-label={`Chọn ${file.name}`}
          checked={selected.has(file.id)}
          onChange={() => {}}
          onClick={(event) => onSelect(file.id, event.shiftKey)}
        />
      </label>
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
  const sortHeader = (label, ascending, descending, resizable = false) => {
    const current = sort === ascending || sort === descending;
    return (
      <th
        className={resizable ? 'name-column-heading' : undefined}
        aria-sort={current ? (sort === ascending ? 'ascending' : 'descending') : undefined}
      >
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
        {resizable && onNameResize && (
          <span
            className="name-column-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label="Độ rộng cột tên"
            tabIndex={0}
            aria-valuemin={240}
            aria-valuemax={720}
            aria-valuenow={Math.round(nameColumnWidth)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              onNameResize(
                event.key === 'Home'
                  ? 240
                  : event.key === 'End'
                    ? 720
                    : nameColumnWidth +
                      (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 40 : 10),
              );
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              const target = event.currentTarget;
              target.focus();
              target.setPointerCapture(event.pointerId);
              const start = event.clientX,
                initial = nameColumnWidth;
              const move = (next) => onNameResize(initial + next.clientX - start);
              const finish = () => {
                target.removeEventListener('pointermove', move);
                target.removeEventListener('pointerup', finish);
                target.removeEventListener('pointercancel', finish);
              };
              target.addEventListener('pointermove', move);
              target.addEventListener('pointerup', finish);
              target.addEventListener('pointercancel', finish);
            }}
          />
        )}
      </th>
    );
  };
  if (view === 'grid')
    return (
      <>
        <div className="grid-select">
          {selected && (
            <div className="grid-select-label">
              <SelectAll files={files} selected={selected} onSelectAll={onSelectAll} />
              Chọn tất cả trên trang
            </div>
          )}
        </div>
        <div className={`file-grid density-${density}`}>
          {files.map((file) => (
            <article
              className={`file-card ${selected?.has(file.id) ? 'selected' : ''}`}
              key={file.id}
            >
              <div className="file-card-top">
                {checkbox(file)}
                <FileIcon file={file} large />
                <FileActions file={file} {...actions} />
              </div>
              <button
                className="file-name"
                title={file.name}
                onClick={() => (actions.onOpen || actions.onInspect)?.(file.id)}
              >
                {file.name}
              </button>
              <p className="file-meta">
                {[
                  showSize ? formatBytes(file.size) : null,
                  showDate ? new Date(file.createdAt).toLocaleDateString('vi-VN') : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
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
    <div className={`table-scroll file-table-scroll density-${density}`}>
      <table
        className="file-table processing-table"
        style={{
          minWidth:
            nameColumnWidth +
            (selected ? 44 : 0) +
            (showSize ? 85 : 0) +
            (showDate ? 100 : 0) +
            399,
        }}
      >
        <colgroup>
          {selected && <col style={{ width: 44 }} />}
          <col style={{ width: nameColumnWidth }} />
          {showSize && <col style={{ width: 85 }} />}
          {showDate && <col style={{ width: 100 }} />}
          <col style={{ width: 115 }} />
          <col style={{ width: 160 }} />
          <col style={{ width: 124 }} />
        </colgroup>
        <thead>
          <tr>
            {selected && (
              <th className="checkbox-cell">
                <SelectAll files={files} selected={selected} onSelectAll={onSelectAll} />
              </th>
            )}
            {sortHeader('Tên tệp', 'name', 'name-desc', true)}
            {showSize && sortHeader('Kích thước', 'size', 'size-desc')}
            {showDate && sortHeader('Thời gian thêm', 'oldest', 'newest')}
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
                      onClick={() => (actions.onOpen || actions.onInspect)?.(file.id)}
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
              {showSize && <td className="nowrap">{formatBytes(file.size)}</td>}
              {showDate && (
                <td className="nowrap">
                  {new Date(file.createdAt).toLocaleTimeString('vi-VN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  <span className="cell-date">
                    {new Date(file.createdAt).toLocaleDateString('vi-VN')}
                  </span>
                </td>
              )}
              <td>
                <StatusBadge {...file} />
              </td>
              <td>
                <ScanBadge {...file} />
              </td>
              <td>
                <FileActions file={file} {...actions} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

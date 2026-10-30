import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, FolderOpen, SearchX } from 'lucide-react';
import FileIcon from './FileIcon.jsx';
import StatusBadge from './StatusBadge.jsx';
import ScanBadge from './ScanBadge.jsx';
import { formatBytes } from '../utils/files.js';
import FileActions from './FileActions.jsx';
import { previewInfo } from '../utils/content.js';

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
  nameColumnResized = false,
  compactPanel = false,
  showSize = true,
  showDate = true,
  onNameResize,
  ...actions
}) {
  const tableContainer = useRef(null);
  const dragCleanup = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, viewport: window.innerWidth });
  const hasFiles = files.length > 0;
  useEffect(() => {
    const container = tableContainer.current;
    if (!container) return;
    const measure = () => {
      const next = { width: container.clientWidth, viewport: window.innerWidth };
      setDimensions((current) =>
        current.width === next.width && current.viewport === next.viewport ? current : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [view, hasFiles, compactPanel]);
  useEffect(() => () => dragCleanup.current?.(), []);
  const showSecondary = !compactPanel || dimensions.viewport > 1650;
  const dateVisible = showDate && showSecondary;
  const metadata = [
    ...(showSize ? [{ key: 'size', min: 116, preferred: 128 }] : []),
    ...(dateVisible ? [{ key: 'date', min: 140, preferred: 164 }] : []),
    ...(showSecondary ? [{ key: 'upload', min: 140, preferred: 160 }] : []),
    { key: 'scan', min: 184, preferred: 208 },
  ];
  const fixedWidth = (selected ? 44 : 0) + 132;
  const minimumMetadata = metadata.reduce((sum, col) => sum + col.min, 0);
  const preferredMetadata = metadata.reduce((sum, col) => sum + col.preferred, 0);
  const tableWidth = Math.max(dimensions.width, 240 + fixedWidth + minimumMetadata);
  const maximumNameWidth = Math.min(4000, tableWidth - fixedWidth - minimumMetadata);
  const actualNameWidth = Math.min(
    maximumNameWidth,
    Math.max(
      240,
      nameColumnResized
        ? nameColumnWidth
        : Math.max(320, tableWidth - fixedWidth - preferredMetadata),
    ),
  );
  const extraMetadata = tableWidth - fixedWidth - actualNameWidth - minimumMetadata;
  const columnWidths = Object.fromEntries(
    metadata.map((col) => [col.key, col.min + (extraMetadata * col.preferred) / preferredMetadata]),
  );
  const resizeName = (value) =>
    onNameResize?.(Math.round(Math.min(maximumNameWidth, Math.max(240, value))));
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
  const previewButton = (file) =>
    actions.contentAvailable &&
    previewInfo(file).kind && (
      <button
        className="file-preview-shortcut"
        aria-label={`Xem trước ${file.name}`}
        title={`Xem trước ${file.name}`}
        onClick={() => actions.onPreview?.(file.id)}
      >
        <Eye size={17} />
        <span>Xem</span>
      </button>
    );
  const statuses = (file) => (
    <div className="file-card-statuses">
      <div>
        <span>Tải lên</span>
        <StatusBadge {...file} />
      </div>
      <div>
        <span>Quét / cách ly</span>
        <ScanBadge
          {...file}
          onInspect={actions.onInspectScan ? () => actions.onInspectScan(file.id) : undefined}
        />
      </div>
    </div>
  );
  const sortHeader = (label, ascending, descending, resizable = false) => {
    const current = sort === ascending || sort === descending;
    return (
      <th
        className={
          resizable
            ? 'name-column-heading'
            : label === 'Thời gian thêm'
              ? 'metadata-column file-date-column'
              : 'metadata-column'
        }
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
            aria-valuemax={Math.floor(maximumNameWidth)}
            aria-valuenow={Math.round(actualNameWidth)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              resizeName(
                event.key === 'Home'
                  ? 240
                  : event.key === 'End'
                    ? maximumNameWidth
                    : actualNameWidth +
                      (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 40 : 10),
              );
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              dragCleanup.current?.();
              const target = event.currentTarget;
              target.focus();
              target.setPointerCapture(event.pointerId);
              const start = event.clientX,
                initial = target.closest('th').getBoundingClientRect().width;
              const move = (next) => resizeName(initial + next.clientX - start);
              const finish = () => {
                target.removeEventListener('pointermove', move);
                target.removeEventListener('pointerup', finish);
                target.removeEventListener('pointercancel', finish);
                target.removeEventListener('lostpointercapture', finish);
                if (target.hasPointerCapture(event.pointerId))
                  target.releasePointerCapture(event.pointerId);
                dragCleanup.current = null;
              };
              target.addEventListener('pointermove', move);
              target.addEventListener('pointerup', finish);
              target.addEventListener('pointercancel', finish);
              target.addEventListener('lostpointercapture', finish);
              dragCleanup.current = finish;
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
              {previewButton(file)}
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
    <div ref={tableContainer} className={`table-scroll file-table-scroll density-${density}`}>
      <table
        className="file-table processing-table"
        style={{ width: tableWidth, minWidth: tableWidth }}
      >
        <colgroup>
          {selected && <col style={{ width: 44 }} />}
          <col style={{ width: actualNameWidth }} />
          {showSize && <col style={{ width: columnWidths.size }} />}
          {dateVisible && <col className="file-date-column" style={{ width: columnWidths.date }} />}
          {showSecondary && (
            <col className="file-upload-column" style={{ width: columnWidths.upload }} />
          )}
          <col style={{ width: columnWidths.scan }} />
          <col style={{ width: 132 }} />
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
            {dateVisible && sortHeader('Thời gian thêm', 'oldest', 'newest')}
            {showSecondary && <th className="metadata-column file-upload-column">Tải lên</th>}
            <th className="metadata-column file-scan-column">Quét / cách ly</th>
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
                  {previewButton(file)}
                </div>
              </td>
              {showSize && <td className="nowrap metadata-column">{formatBytes(file.size)}</td>}
              {dateVisible && (
                <td className="nowrap metadata-column file-date-column">
                  <time className="cell-date" dateTime={new Date(file.createdAt).toISOString()}>
                    {new Date(file.createdAt).toLocaleDateString('vi-VN')}
                  </time>
                  <span className="cell-time">
                    {new Date(file.createdAt).toLocaleTimeString('vi-VN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </td>
              )}
              {showSecondary && (
                <td className="metadata-column file-upload-column">
                  <StatusBadge {...file} />
                </td>
              )}
              <td className="metadata-column file-scan-column">
                <ScanBadge
                  {...file}
                  onInspect={
                    actions.onInspectScan ? () => actions.onInspectScan(file.id) : undefined
                  }
                />
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

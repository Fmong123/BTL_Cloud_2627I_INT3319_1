import { ArrowDown, ArrowUp, CloudUpload, Eye, FolderOpen, RotateCcw, SearchX, Star, X } from 'lucide-react';
import FileIcon from './FileIcon.jsx';
import StatusBadge from './StatusBadge.jsx';
import { formatBytes } from '../utils/files.js';

function Actions({ file, onStar, onInspect, onRetry, onCancel }) {
  return <div className="file-actions">
    {['queued', 'uploading'].includes(file.status) ? <button className="icon-button" title="Hủy tải lên" aria-label={`Hủy tải ${file.name}`} onClick={() => onCancel(file.id)}><X size={16} /></button> : <>
      {['error', 'cancelled'].includes(file.status) && <button className="icon-button" title="Thử lại" aria-label={`Thử lại ${file.name}`} onClick={() => onRetry(file.id)}><RotateCcw size={16} /></button>}
      <button className={`icon-button star-button ${file.starred ? 'starred' : ''}`} title={file.starred ? 'Bỏ đánh dấu' : 'Đánh dấu'} aria-label={`${file.starred ? 'Bỏ đánh dấu' : 'Đánh dấu'} ${file.name}`} aria-pressed={file.starred} onClick={() => onStar(file.id)}><Star size={16} fill={file.starred ? 'currentColor' : 'none'} /></button>
      <button className="icon-button" title="Thông tin tệp" aria-label={`Thông tin ${file.name}`} onClick={() => onInspect(file.id)}><Eye size={17} /></button>
    </>}
  </div>;
}

export default function FileList({ files, view, hasFiles, filtered, onChoose, sort, onSort, ...actions }) {
  if (!files.length) return <div className="empty-state">
    <span className="empty-icon">{filtered ? <SearchX size={29} /> : <FolderOpen size={29} />}</span>
    <h3>{filtered ? 'Chưa tìm thấy tệp phù hợp' : 'Một khởi đầu thật gọn gàng'}</h3>
    <p>{filtered ? 'Thử một từ khóa khác hoặc thay đổi bộ lọc' : 'Tải lên tài liệu đầu tiên — tệp của bạn sẽ xuất hiện ở đây'}</p>
    {!hasFiles && !filtered && <button className="text-button" onClick={onChoose}><CloudUpload size={16} />Tải tệp đầu tiên</button>}
  </div>;

  if (view === 'grid') return <div className="file-grid">{files.map((file) => <article className="file-card" key={file.id}>
    <div className="file-card-top"><FileIcon file={file} large /><Actions file={file} {...actions} /></div>
    <button className="file-name" onClick={() => actions.onInspect(file.id)} title={file.name}>{file.name}</button>
    <p>{formatBytes(file.size)}<span>·</span>{new Date(file.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</p>
    <StatusBadge status={file.status} mode={file.mode} progress={file.progress} />
    {file.status === 'uploading' && <progress max="100" value={file.progress} aria-label={`Tiến độ ${file.name}`} />}
    {file.error && <p className="file-error">{file.error}</p>}
  </article>)}</div>;

  return <div className="table-scroll"><table className="file-table"><thead><tr>
    <th><button onClick={() => onSort(sort === 'name' ? 'newest' : 'name')}>Tên tệp{sort === 'name' && <ArrowUp size={13} />}</button></th><th>Kích thước</th>
    <th><button onClick={() => onSort(sort === 'newest' ? 'oldest' : 'newest')}>Thời gian{sort === 'newest' ? <ArrowDown size={13} /> : sort === 'oldest' ? <ArrowUp size={13} /> : null}</button></th><th>Trạng thái</th><th><span className="visually-hidden">Thao tác</span></th>
  </tr></thead><tbody>{files.map((file) => <tr key={file.id}>
    <td><div className="file-title-cell"><FileIcon file={file} /><div className="file-title-text"><button className="file-name" title={file.name} onClick={() => actions.onInspect(file.id)}>{file.name}</button>{file.error && <span className="file-error">{file.error}</span>}{file.status === 'uploading' && <progress max="100" value={file.progress} aria-label={`Tiến độ ${file.name}`} />}</div></div></td>
    <td>{formatBytes(file.size)}</td><td>{new Date(file.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}<span className="cell-date">{new Date(file.createdAt).toLocaleDateString('vi-VN')}</span></td>
    <td><StatusBadge status={file.status} mode={file.mode} progress={file.progress} /></td><td><Actions file={file} {...actions} /></td>
  </tr>)}</tbody></table></div>;
}

import { Copy } from 'lucide-react';
import { useWorkspace } from '../state/Workspace.jsx';
import { formatBytes } from '../utils/files.js';
import { isBusy } from '../utils/workspace.js';
import Modal from './Modal.jsx';
import FileIcon from './FileIcon.jsx';
import StatusBadge from './StatusBadge.jsx';

export default function FileDetail({ id, onClose }) {
  const w = useWorkspace();
  const file = w.files.find((item) => item.id === id);
  if (!file) return null;
  async function copy(value) {
    try {
      await navigator.clipboard.writeText(String(value));
      w.notify('Đã sao chép');
    } catch {
      w.notify('Không thể sao chép tự động. Bạn có thể chọn và sao chép nội dung trong chi tiết.');
    }
  }
  const copyRow = (label, value) => (
    <div>
      <dt>{label}</dt>
      <dd className="copy-value">
        <span>{value}</span>
        <button
          className="icon-button"
          aria-label={`Sao chép ${label.toLowerCase()}`}
          onClick={() => copy(value)}
        >
          <Copy size={16} />
        </button>
      </dd>
    </div>
  );
  return (
    <Modal title="Thông tin tệp" onClose={onClose}>
      <div className="detail-title">
        <FileIcon file={file} large />
        <h3>{file.name}</h3>
      </div>
      <dl className="file-details">
        {copyRow('Tên tệp', file.name)}
        <div>
          <dt>Trạng thái</dt>
          <dd>
            <StatusBadge {...file} />
          </dd>
        </div>
        <div>
          <dt>Kích thước</dt>
          <dd>{formatBytes(file.size)}</dd>
        </div>
        <div>
          <dt>Định dạng</dt>
          <dd>{file.type || 'Không xác định'}</dd>
        </div>
        <div>
          <dt>Thời gian thêm</dt>
          <dd>{new Date(file.createdAt).toLocaleString('vi-VN')}</dd>
        </div>
        <div>
          <dt>Nơi lưu trữ</dt>
          <dd>
            {file.mode === 'demo'
              ? 'Trải nghiệm — chưa gửi tệp đến máy chủ'
              : file.status !== 'success'
                ? 'Chưa được xác nhận'
                : file.storage === 'local'
                  ? 'Ổ đĩa máy chạy API'
                  : file.storage === 's3'
                    ? 'Amazon S3'
                    : 'Máy chủ chưa khai báo loại lưu trữ'}
          </dd>
        </div>
        {file.remoteId != null && copyRow('ID máy chủ', file.remoteId)}
        {file.key && copyRow('Object key', file.key)}
        <div>
          <dt>Quét dữ liệu</dt>
          <dd>
            {file.mode === 'demo'
              ? 'Không áp dụng cho tệp trải nghiệm'
              : file.scanStatus === 'not_started'
                ? 'Máy chủ báo chưa bắt đầu quét'
                : 'Chưa có kết quả quét được tích hợp'}
          </dd>
        </div>
      </dl>
      {file.error && (
        <p className="banner error" role="alert">
          {file.error}
        </p>
      )}
      <p className="info-box">
        Tải lên thành công không xác nhận tệp đã được quét hoặc an toàn. Object key là định danh lưu
        trữ, không phải liên kết tải xuống.
      </p>
      <div className="modal-footer">
        <button
          className="button secondary"
          disabled={isBusy(file)}
          onClick={() => {
            w.remove([id]);
            onClose();
          }}
        >
          Bỏ khỏi danh sách
        </button>
        <button className="button primary" onClick={onClose}>
          Đóng
        </button>
      </div>
    </Modal>
  );
}

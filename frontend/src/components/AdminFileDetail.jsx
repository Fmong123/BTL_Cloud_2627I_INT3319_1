import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { getAdminFileDetail } from '../api/client.js';
import { formatBytes } from '../utils/files.js';
import { scanExplanation } from '../utils/processing.js';
import Modal from './Modal.jsx';
import FileHistory from './FileHistory.jsx';
import ScanBadge from './ScanBadge.jsx';
import ExtractionReport from './ExtractionReport.jsx';

const at = (value) => (value ? new Date(value).toLocaleString('vi-VN') : 'Chưa có');
const types = { CCCD_VN: 'Căn cước công dân', CREDIT_CARD: 'Thẻ ngân hàng' };

export default function AdminFileDetail({
  item,
  baseUrl,
  onClose,
  onDownload,
  downloading,
  revision,
  downloadError,
}) {
  const [state, setState] = useState({ loading: true });
  const [reload, refresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true });
    getAdminFileDetail(baseUrl, item.id, item.owner_id, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setState({ data });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setState({ error: error.message });
      });
    return () => controller.abort();
  }, [baseUrl, item.id, item.owner_id, reload, revision]);
  const data = state.data;
  return (
    <Modal title="Chi tiết tệp cách ly" wide className="admin-detail-modal" onClose={onClose}>
      <div className="admin-detail-body">
        <div className="admin-detail-title">
          <div>
            <h3>{item.display_name || item.original_name}</h3>
            <p className="muted">Chủ sở hữu: {data?.owner_name || item.owner_name}</p>
          </div>
          <div className="inline-actions">
            <button
              className="button secondary"
              disabled={state.loading}
              onClick={() => refresh((x) => x + 1)}
            >
              <RefreshCw size={15} />
              Cập nhật chi tiết
            </button>
            <button
              className="button secondary"
              disabled={!(data ? data.can_read : item.can_read) || downloading}
              onClick={() => onDownload(item)}
            >
              <Download size={15} />
              Tải bản cách ly
            </button>
          </div>
        </div>
        {state.loading && <p role="status">Đang đọc chi tiết tệp…</p>}
        {state.error && (
          <p className="banner warning" role="alert">
            {state.error}
          </p>
        )}
        {downloadError && (
          <p className="banner warning" role="alert">
            {downloadError}
          </p>
        )}
        {data && (
          <div className="admin-detail-columns">
            <div>
              <section className="admin-detail-card" aria-label="Thông tin tệp">
                <h3>Thông tin tệp</h3>
                <dl className="file-details">
                  <div>
                    <dt>Trạng thái</dt>
                    <dd>
                      <ScanBadge
                        scanStatus={data.file.scan_status}
                        statusReason={data.file.status_reason}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>Kích thước</dt>
                    <dd>{formatBytes(data.file.size_bytes)}</dd>
                  </div>
                  <div>
                    <dt>Tải lên lúc</dt>
                    <dd>{at(data.file.created_at)}</dd>
                  </div>
                  <div>
                    <dt>Quét lúc</dt>
                    <dd>{at(data.file.scanned_at)}</dd>
                  </div>
                  <div>
                    <dt>Cách ly lúc</dt>
                    <dd>{at(data.file.quarantined_at)}</dd>
                  </div>
                  <div>
                    <dt>Cập nhật lúc</dt>
                    <dd>{at(data.file.updated_at)}</dd>
                  </div>
                </dl>
                {data.report.statusReason &&
                  data.report.statusReason !== data.report.scanReason && (
                    <p className="banner warning">{scanExplanation(data.report)}</p>
                  )}
              </section>
              <section className="admin-detail-card" aria-label="Kết quả kiểm tra">
                <h3>Kết quả kiểm tra</h3>
                <p className="admin-findings-total">
                  <strong>{data.report.findingsCount}</strong> phát hiện
                </p>
                <ul className="scan-finding-counts">
                  {data.report.findingCounts.map(({ type, count }) => (
                    <li key={type}>
                      <span>{types[type] || type}</span>
                      <strong>{count}</strong>
                    </li>
                  ))}
                </ul>
                {!data.report.countsComplete && (
                  <p className="scan-report-note">Chưa có thống kê đầy đủ theo từng loại.</p>
                )}
                <ExtractionReport report={data.report} />
                <p className="scan-report-note">
                  Chỉ hiển thị thống kê, không hiển thị nội dung nhạy cảm của tài liệu.
                </p>
              </section>
            </div>
            <div className="admin-detail-card">
              <FileHistory
                key={`${item.owner_id}:${item.id}:${revision}`}
                ownerId={item.owner_id}
                file={{ remoteId: item.id, mode: 'api', connection: { baseUrl } }}
              />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

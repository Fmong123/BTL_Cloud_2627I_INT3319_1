import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { getAdminFileDetail } from '../api/client.js';
import { formatBytes } from '../utils/files.js';
import { scanExplanation } from '../utils/processing.js';
import Modal from './Modal.jsx';
import FileHistory from './FileHistory.jsx';
import ScanBadge from './ScanBadge.jsx';
import ExtractionReport from './ExtractionReport.jsx';
import DetailTabs from './DetailTabs.jsx';
import QuarantineReview from './QuarantineReview.jsx';
import PipelineRecovery from './PipelineRecovery.jsx';

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
  focusReview = false,
  onReviewSaved,
}) {
  const [state, setState] = useState({ loading: true });
  const [reload, refresh] = useState(0);
  const [tab, setTab] = useState('information');
  useEffect(() => {
    const controller = new AbortController();
    setState((previous) => ({ ...previous, loading: true }));
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
    <Modal title="Chi tiết xử lý tệp" wide className="admin-detail-modal" onClose={onClose}>
      <div className="admin-detail-body">
        <div className="admin-detail-title">
          <div>
            <h3>
              {data?.file.display_name ||
                data?.file.original_name ||
                item.display_name ||
                item.original_name ||
                'Đang mở chi tiết tệp'}
            </h3>
            <p className="muted">
              Chủ sở hữu: {data?.owner_name || item.owner_name || item.owner_id}
            </p>
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
            {onDownload && (
              <button
                className="button secondary"
                disabled={!(data ? data.can_read : item.can_read) || downloading}
                title={data && !data.can_read ? 'Tệp chưa có bản cách ly có thể tải' : undefined}
                onClick={() => onDownload(data?.file ?? item)}
              >
                <Download size={15} />
                Tải bản cách ly
              </button>
            )}
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
          <div>
            <QuarantineReview
              baseUrl={baseUrl}
              id={item.id}
              ownerId={item.owner_id}
              initialReview={data.quarantine_review}
              focusReason={focusReview}
              onDecision={() => {
                refresh((value) => value + 1);
                onReviewSaved?.();
              }}
            />
            <DetailTabs prefix="admin-detail" value={tab} onChange={setTab} />
            <div className="admin-detail-panels">
              {tab === 'information' && (
                <section
                  className="admin-detail-card"
                  role="tabpanel"
                  id="admin-detail-information"
                  aria-labelledby="admin-detail-information-tab"
                >
                  <h3>Thông tin tệp</h3>
                  <dl className="file-details">
                    <div>
                      <dt>Thư mục của chủ sở hữu</dt>
                      <dd>{['Tệp của tôi', ...(data.folder_path || [])].join(' / ')}</dd>
                    </div>
                    <div>
                      <dt>Trạng thái</dt>
                      <dd>
                        <ScanBadge
                          scanStatus={data.file.scan_status}
                          statusReason={data.file.status_reason}
                          scanStartedAt={Date.parse(data.file.scan_started_at)}
                          createdAt={Date.parse(data.file.created_at)}
                          rescanRequestedAt={Date.parse(data.file.rescan_requested_at)}
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
                      <dt>Bắt đầu quét</dt>
                      <dd>{at(data.file.scan_started_at)}</dd>
                    </div>
                    <div>
                      <dt>Hoàn tất quét</dt>
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
              )}
              {tab === 'processing' && (
                <section
                  className="admin-detail-card"
                  role="tabpanel"
                  id="admin-detail-processing"
                  aria-labelledby="admin-detail-processing-tab"
                >
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
                  <PipelineRecovery
                    baseUrl={baseUrl}
                    id={item.id}
                    ownerId={item.owner_id}
                    initial={data.pipeline}
                    onChange={() => {
                      refresh((value) => value + 1);
                      onReviewSaved?.();
                    }}
                  />
                  <p className="scan-report-note">
                    Chỉ hiển thị thống kê, không hiển thị nội dung nhạy cảm của tài liệu.
                  </p>
                </section>
              )}
            </div>
            {tab === 'history' && (
              <div
                className="admin-detail-card"
                role="tabpanel"
                id="admin-detail-history"
                aria-labelledby="admin-detail-history-tab"
              >
                <FileHistory
                  key={`${item.owner_id}:${item.id}:${revision}`}
                  ownerId={item.owner_id}
                  file={{ remoteId: item.id, mode: 'api', connection: { baseUrl } }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

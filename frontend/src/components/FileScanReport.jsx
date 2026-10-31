import { useEffect, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { getScanReport, rescanFile } from '../api/client.js';
import { useWorkspace } from '../state/Workspace.jsx';
import { scanExplanation, scanStates } from '../utils/processing.js';

const types = {
  CCCD_VN: 'Căn cước công dân',
  CREDIT_CARD: 'Thẻ ngân hàng',
  EMAIL: 'Email',
  PHONE: 'Số điện thoại',
  API_KEY: 'API key',
  PASSWORD: 'Mật khẩu',
};
const at = (value) =>
  value
    ? new Date(value).toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Chưa có';

export default function FileScanReport({ file, refreshKey }) {
  const w = useWorkspace();
  const current = useRef(w);
  current.current = w;
  const [state, setState] = useState(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const identity = `${file.scope}:${file.remoteId}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const requests = useRef(new Map());
  const action = useRef(null);
  const baseUrl = w.preferences.baseUrl;
  useEffect(() => {
    setMessage(null);
    setBusy(false);
    action.current?.abort();
    return () => action.current?.abort();
  }, [identity]);
  useEffect(() => {
    if (!w.scanReportAvailable || !file.remoteId || file.lifecycleState === 'purged') return;
    const controller = new AbortController();
    setState({ identity, loading: true });
    getScanReport(baseUrl, file.remoteId, { signal: controller.signal })
      .then((report) => {
        if (controller.signal.aborted) return;
        setState({ identity, report });
        if (
          requests.current.get(identity) === report.rescanRequestId &&
          ['started', 'failed'].includes(report.rescanDispatch)
        )
          requests.current.delete(identity);
        if (report.updatedAt > file.updatedAt || report.scanStatus !== file.scanStatus)
          current.current.applyScanStatus(file, report);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setState({ identity, error: error.message });
      });
    return () => controller.abort();
  }, [
    identity,
    baseUrl,
    file.updatedAt,
    file.scanStatus,
    w.scanReportAvailable,
    reload,
    refreshKey,
  ]);
  const report =
    state?.identity === identity &&
    state.report?.updatedAt >= file.updatedAt &&
    state.report?.scanStatus === file.scanStatus
      ? state.report
      : null;
  const resolving =
    report &&
    ['pending', 'unknown'].includes(report.rescanDispatch) &&
    file.scanStatus === 'scanning';
  const permitted =
    file.uploadState === 'uploaded' &&
    ['safe', 'error', 'unscanned', 'not_started'].includes(file.scanStatus);
  const reason =
    file.lifecycleState && file.lifecycleState !== 'active'
      ? 'Khôi phục tệp khỏi Thùng rác trước khi quét lại.'
      : !w.rescanAvailable
        ? 'Dịch vụ quét lại chưa được bật.'
        : file.storage !== 's3'
          ? 'Quét lại cần tệp gốc trên S3.'
          : !permitted && !resolving
            ? 'Tệp đang xử lý hoặc đã cách ly không thể quét lại tại đây.'
            : null;
  async function requestScan() {
    if (reason || action.current) return;
    const controller = new AbortController();
    action.current = controller;
    setBusy(true);
    setMessage(null);
    const requestId =
      (resolving && report.rescanRequestId) ||
      requests.current.get(identity) ||
      crypto.randomUUID();
    requests.current.set(identity, requestId);
    try {
      const result = await rescanFile(baseUrl, file.remoteId, requestId, {
        signal: controller.signal,
      });
      if (controller.signal.aborted || identityRef.current !== identity) return;
      requests.current.delete(identity);
      current.current.applyScanStatus(file, result);
      setState({ identity, report: result });
      current.current.notify(
        result.scanStatus === 'scanning'
          ? 'Đã gửi yêu cầu quét lại'
          : 'Đã cập nhật kết quả lượt quét',
      );
    } catch (error) {
      if (controller.signal.aborted || identityRef.current !== identity) return;
      if (error.status >= 400 && error.status < 500) requests.current.delete(identity);
      setMessage(error.message);
      setReload((value) => value + 1);
    } finally {
      if (action.current === controller) {
        action.current = null;
        if (identityRef.current === identity) setBusy(false);
      }
    }
  }
  const hasResult = ['safe', 'flagged', 'quarantined', 'quarantine_delete_failed'].includes(
    file.scanStatus,
  );
  const counts = report?.findingCounts || [];
  const findings = counts.length
    ? counts
    : (file.findingTypes || []).map((type) => ({ type, count: null }));
  return (
    <section className="scan-report" aria-label="Báo cáo quét chi tiết">
      <div className="scan-report-heading">
        <ShieldCheck size={20} />
        <h3>Báo cáo quét</h3>
      </div>
      {file.mode === 'demo' ? (
        <p>Tệp trải nghiệm chưa được gửi đi quét.</p>
      ) : (
        <>
          <div className="scan-report-total">
            <strong>{hasResult ? (file.findingsCount ?? '—') : '—'}</strong>
            <span>
              {hasResult
                ? 'phát hiện dữ liệu nhạy cảm'
                : file.scanStatus === 'scanning'
                  ? 'Đang chờ kết quả mới'
                  : 'Chưa có kết quả đầy đủ'}
            </span>
          </div>
          {findings.length > 0 && (
            <ul className="scan-finding-counts" aria-label="Phát hiện theo loại">
              {findings.map(({ type, count }) => (
                <li key={type}>
                  <span>{types[type] || type}</span>
                  <strong>{count ?? 'Chưa có số lượng'}</strong>
                </li>
              ))}
            </ul>
          )}
          {findings.length > 0 && !report?.countsComplete && (
            <p className="scan-report-note">Chưa có thống kê đầy đủ theo từng loại.</p>
          )}
          <dl className="file-details">
            <div>
              <dt>Quét lúc</dt>
              <dd>{at(file.scannedAt)}</dd>
            </div>
            <div>
              <dt>Kết quả</dt>
              <dd>{scanStates[file.scanStatus]?.label || 'Chưa có kết quả'}</dd>
            </div>
            {report?.rescanRequestedAt && (
              <div>
                <dt>Yêu cầu quét lại</dt>
                <dd>{at(report.rescanRequestedAt)}</dd>
              </div>
            )}
          </dl>
          {report && report.extractionComplete !== true && file.scanStatus !== 'scanning' && (
            <p className="scan-report-note">
              {report.extractionComplete === false
                ? 'Chưa đọc hết nội dung tệp.'
                : 'Chưa xác nhận đã đọc đầy đủ.'}
            </p>
          )}
          {['error', 'unscanned'].includes(file.scanStatus) &&
            (report?.scanReason || file.statusReason) && (
              <p className="scan-report-note">
                {scanExplanation({
                  ...file,
                  statusReason: report?.scanReason || file.statusReason,
                })}
              </p>
            )}
          {w.scanReportAvailable && state?.identity === identity && state.loading && (
            <p role="status">Đang đọc báo cáo…</p>
          )}
          {state?.identity === identity && state.error && (
            <div className="banner warning" role="alert">
              {state.error}{' '}
              <button className="text-button" onClick={() => setReload((value) => value + 1)}>
                Đọc lại báo cáo
              </button>
            </div>
          )}
          {message && (
            <p className="banner warning" role="alert">
              {message}
            </p>
          )}
          <button
            className="button secondary"
            disabled={busy || Boolean(reason)}
            title={reason || undefined}
            onClick={requestScan}
          >
            <RefreshCw size={16} />
            {busy ? 'Đang gửi yêu cầu…' : resolving ? 'Xác nhận lượt quét' : 'Quét lại tệp'}
          </button>
          {reason && <p className="scan-report-note">{reason}</p>}
          <p className="scan-report-note">
            Chỉ hiển thị loại và số lượng. Không phải kết quả quét mã độc.
          </p>
        </>
      )}
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import { RefreshCw, ShieldAlert, Send, Check, Clock3, CircleAlert } from 'lucide-react';
import { runPipelineOperation } from '../api/client.js';

const deliveryLabels = {
  not_recorded: 'Chưa ghi nhận gửi',
  failed: 'Gửi thất bại',
  sending: 'Đang gửi / cần đối chiếu',
  unknown: 'Chưa rõ kết quả',
  sent: 'Đã xác nhận gửi',
};
const jobLabels = {
  pending: 'Chờ xác nhận khởi chạy',
  unknown: 'Chưa rõ kết quả khởi chạy',
  started: 'Đã khởi chạy · chờ kiểm tra kết quả',
  succeeded: 'Đã xác nhận hoàn tất',
  failed: 'Cần xử lý tiếp',
  retired: 'Đã kết thúc yêu cầu kênh cũ',
};
const quarantineLabels = {
  copy_failed: 'Sao chép bản cách ly lỗi',
  delete_failed: 'Xóa bản nguồn lỗi',
  copied: 'Đã sao chép · chưa xác nhận xóa nguồn',
  completed: 'Cách ly hoàn tất',
  pending: 'Đang chờ cách ly',
};
const at = (value) => (value ? new Date(value).toLocaleString('vi-VN') : 'Chưa ghi nhận');

function DeliveryStatus({ state }) {
  const Icon = state === 'sent' ? Check : state === 'failed' ? CircleAlert : Clock3;
  const tone = state === 'sent' ? 'success' : state === 'failed' ? 'error' : 'warning';
  return (
    <span className={`status-badge ${tone}`}>
      <Icon size={13} />
      <span className="status-label">{deliveryLabels[state] || 'Cần kiểm tra trạng thái'}</span>
    </span>
  );
}

export default function PipelineRecovery({ baseUrl, id, ownerId, initial, onChange }) {
  const [pipeline, setPipeline] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [choice, setChoice] = useState(null);
  const [reason, setReason] = useState('');
  const [receipt, setReceipt] = useState('');
  const [evidence, setEvidence] = useState('');
  const [duplicate, setDuplicate] = useState(false);
  const pending = useRef(null);
  useEffect(() => setPipeline(initial), [initial]);
  if (!pipeline) return null;

  function choose(action, channel) {
    setChoice({ action, channel });
    setReason('');
    setReceipt('');
    setEvidence('');
    setDuplicate(false);
    setFeedback(null);
    pending.current = null;
  }
  async function run(action, channel) {
    setBusy(true);
    setFeedback(null);
    const values = {
      action,
      ...(channel && { channel }),
      ...(action !== 'check' && { reason, allow_duplicate: duplicate }),
      ...(action === 'confirm_sent' && { receipt, evidence }),
    };
    const signature = JSON.stringify(values);
    if (!pending.current || pending.current.signature !== signature)
      pending.current = { signature, request_id: crypto.randomUUID() };
    try {
      const result = await runPipelineOperation(baseUrl, id, ownerId, {
        ...values,
        revision: pipeline.revision,
        request_id: pending.current.request_id,
      });
      setPipeline(result.pipeline);
      setFeedback({ message: result.message });
      setChoice(null);
      pending.current = null;
      onChange?.();
    } catch (error) {
      setFeedback({ message: error.message, error: true });
      if (error.status === 409 || error.status === 422) pending.current = null;
      // Refresh the durable request after a lost HTTP response; keep its request ID for retry.
      onChange?.();
    } finally {
      setBusy(false);
    }
  }
  const channels = pipeline.channels.filter((row) => row.channel === 'sns');
  const selected = channels.find((row) => row.channel === choice?.channel);
  const uncertain = selected && ['sending', 'unknown'].includes(selected.state);
  const disabled = busy || pipeline.busy || pipeline.configured === false;
  return (
    <section className="pipeline-recovery" aria-label="Xử lý cách ly và thông báo">
      <div className="pipeline-heading">
        <h3>Xử lý cách ly và thông báo</h3>
        <button className="button secondary" disabled={busy} onClick={() => run('check')}>
          <RefreshCw size={15} /> Kiểm tra kết quả
        </button>
      </div>
      <p className="muted">
        Xử lý riêng bước gặp lỗi, giữ nguyên kết quả quét. Mỗi thao tác đều được ghi lịch sử.
      </p>
      {pipeline.configured === false && (
        <p className="banner warning">
          Chưa cấu hình workflow xử lý lại. Bạn vẫn có thể xem trạng thái và bằng chứng đã lưu.
        </p>
      )}
      {feedback && (
        <p
          className={`banner ${feedback.error ? 'warning' : ''}`}
          role={feedback.error ? 'alert' : 'status'}
        >
          {feedback.message}
        </p>
      )}
      {pipeline.job && (
        <p className="pipeline-job" role="status">
          <strong>{jobLabels[pipeline.job.state] || pipeline.job.state}</strong>
          {' · '}
          {pipeline.job.action === 'retry_quarantine'
            ? 'Thử lại cách ly'
            : pipeline.job.channel === 'sns'
              ? 'Thông báo SNS / Email'
              : 'Thông báo kênh cũ (đã ngừng)'}
          {' · '}
          {at(pipeline.job.requested_at)}
        </p>
      )}
      {pipeline.busy && (
        <p className="banner warning">
          Đã có yêu cầu đang xử lý. Dùng Kiểm tra kết quả trước khi tạo yêu cầu mới hoặc thay đổi
          vòng đời tệp.
        </p>
      )}
      {pipeline.quarantine_retryable && (
        <div className="pipeline-channel">
          <div>
            <h4>Cách ly tài liệu</h4>
            <p>{quarantineLabels[pipeline.quarantine_step] || 'Chưa hoàn tất cách ly'}</p>
          </div>
          <button
            className="button secondary"
            disabled={disabled}
            onClick={() => choose('retry_quarantine')}
          >
            <ShieldAlert size={15} /> Thử lại cách ly
          </button>
        </div>
      )}
      {channels.map((row) => (
        <div className="pipeline-channel" key={row.channel}>
          <div>
            <h4>SNS / Email</h4>
            <DeliveryStatus state={row.state} />
            <p>Lần gửi: {at(row.attempted_at)}</p>
            {row.receipt && (
              <p>
                Biên nhận: <span className="pipeline-receipt">{row.receipt}</span>
              </p>
            )}
            {row.sent_at && (
              <p>
                {row.confirmed_by ? 'Admin xác nhận lúc' : 'Dịch vụ chấp nhận lúc'}:{' '}
                {at(row.sent_at)}
              </p>
            )}
            {row.confirmed_by && <p>Xác nhận thủ công theo bằng chứng: {row.evidence}</p>}
          </div>
          <div className="inline-actions">
            {['sending', 'unknown'].includes(row.state) && (
              <button
                className="button secondary"
                disabled={disabled}
                onClick={() => choose('confirm_sent', row.channel)}
              >
                Xác nhận theo bằng chứng
              </button>
            )}
            {row.state !== 'sent' && (
              <button
                className="button secondary"
                disabled={disabled}
                onClick={() => choose('retry_notification', row.channel)}
              >
                <Send size={15} /> {row.state === 'not_recorded' ? 'Gửi thông báo' : 'Gửi lại'}
              </button>
            )}
          </div>
        </div>
      ))}
      {!pipeline.quarantine_retryable && !channels.length && (
        <p className="muted">Tệp hiện không có bước cách ly hoặc thông báo cần xử lý tại đây.</p>
      )}
      {channels.length > 0 && (
        <p className="muted">
          Chưa ghi nhận gửi có thể do kênh chưa được cấu hình. Xác nhận gửi là bằng chứng dịch vụ
          nhận yêu cầu, không xác nhận người nhận đã nhận hoặc đọc.
        </p>
      )}
      {choice && (
        <form
          className="pipeline-form"
          onSubmit={(event) => {
            event.preventDefault();
            run(choice.action, choice.channel);
          }}
        >
          <h4>
            {choice.action === 'retry_quarantine'
              ? 'Thử lại bước cách ly'
              : choice.action === 'confirm_sent'
                ? 'Xác nhận kết quả theo bằng chứng'
                : 'Gửi lại thông báo SNS / Email'}
          </h4>
          <label>
            Lý do xử lý
            <textarea
              aria-label="Lý do xử lý pipeline"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              minLength={3}
              maxLength={300}
              rows={2}
            />
          </label>
          {choice.action === 'confirm_sent' && (
            <>
              <label>
                Message ID của SNS
                <input
                  aria-label="Biên nhận gửi"
                  value={receipt}
                  onChange={(e) => setReceipt(e.target.value)}
                  placeholder="UUID Message ID"
                  maxLength={160}
                  required
                />
              </label>
              <label>
                Tham chiếu bằng chứng
                <input
                  aria-label="Tham chiếu bằng chứng"
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                  placeholder="Mã log hoặc mã đối chiếu; không nhập thông tin bí mật"
                  minLength={3}
                  maxLength={300}
                  required
                />
              </label>
            </>
          )}
          {choice.action === 'retry_notification' && uncertain && (
            <label className="pipeline-confirm">
              <input
                type="checkbox"
                checked={duplicate}
                onChange={(e) => setDuplicate(e.target.checked)}
                required
              />
              Tôi đã đối chiếu và chấp nhận nguy cơ gửi trùng vì lần gửi trước chưa rõ kết quả.
            </label>
          )}
          <div className="inline-actions">
            <button
              type="submit"
              className="button primary"
              disabled={
                disabled || (uncertain && choice.action === 'retry_notification' && !duplicate)
              }
            >
              {busy ? 'Đang ghi nhận…' : 'Xác nhận xử lý'}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setChoice(null)}
            >
              Hủy
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

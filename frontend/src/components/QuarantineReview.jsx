import { useEffect, useState } from 'react';
import { quarantineReview } from '../api/client.js';

const labels = {
  pending: 'Đang chờ xem xét',
  keep_quarantine: 'Giữ cách ly',
  recommend_release: 'Chờ xác nhận khôi phục',
  restored: 'Đã khôi phục',
};

export default function QuarantineReview({
  baseUrl,
  id,
  ownerId,
  initialReview,
  focusReason = false,
  refreshKey,
  onDecision,
}) {
  const [review, setReview] = useState(initialReview);
  const [reason, setReason] = useState('');
  const [decision, setDecision] = useState('keep_quarantine');
  const [busy, setBusy] = useState(!ownerId);
  const [error, setError] = useState('');
  useEffect(() => {
    if (ownerId) return;
    const controller = new AbortController();
    quarantineReview(baseUrl, id, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setReview(result);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [baseUrl, id, ownerId, refreshKey]);
  const canSubmit = ownerId
    ? ['pending', 'recommend_release'].includes(review?.status)
    : review === null;
  if (ownerId && !review) return null;
  return (
    <section className="technical-details review-panel">
      <h3>Xem xét cách ly</h3>
      {review && (
        <>
          <p>
            <strong>{labels[review.status]}</strong> · {review.reason}
          </p>
          {review.decision_reason && <p>Lý do của quản trị viên: {review.decision_reason}</p>}
        </>
      )}
      {canSubmit && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            try {
              const updated = await quarantineReview(baseUrl, id, {
                ownerId,
                reason: reason.trim(),
                decision: ownerId ? decision : undefined,
              });
              setReview(updated);
              setReason('');
              if (ownerId) onDecision?.();
            } catch (err) {
              setError(err.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {ownerId && (
            <select
              aria-label="Quyết định"
              value={decision}
              onChange={(event) => setDecision(event.target.value)}
            >
              <option value="keep_quarantine">Giữ cách ly</option>
              <option value="restore">Khôi phục tệp</option>
            </select>
          )}
          <textarea
            autoFocus={focusReason}
            aria-label="Lý do xem xét cách ly"
            placeholder="Nhập lý do, tránh đưa dữ liệu nhạy cảm vào đây"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            required
          />
          <button className="button secondary" disabled={busy || !reason.trim()}>
            {ownerId
              ? decision === 'restore'
                ? 'Xác nhận khôi phục'
                : 'Lưu quyết định'
              : 'Gửi yêu cầu xem xét'}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="muted">
          {error}
        </p>
      )}
    </section>
  );
}

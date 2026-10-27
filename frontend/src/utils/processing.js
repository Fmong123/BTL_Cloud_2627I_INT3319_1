export const scanStates = {
  not_started: { label: 'Chưa bắt đầu quét', tone: 'muted' },
  scanning: { label: 'Đang chờ / đang quét', tone: 'uploading' },
  safe: { label: 'An toàn', tone: 'success' },
  flagged: { label: 'Phát hiện dữ liệu — chờ cách ly', tone: 'warning' },
  quarantined: { label: 'Đã cách ly', tone: 'warning' },
  quarantine_delete_failed: { label: 'Cách ly chưa hoàn tất', tone: 'error' },
  unscanned: { label: 'Không quét được', tone: 'warning' },
  error: { label: 'Lỗi xử lý', tone: 'error' },
};

export const uploadStates = ['uploading', 'uploaded', 'failed', 'unknown'];
const attentionStates = new Set([
  'flagged',
  'quarantined',
  'quarantine_delete_failed',
  'unscanned',
  'error',
]);

export function isAttention(file) {
  return (
    file.mode !== 'demo' &&
    (attentionStates.has(file.scanStatus) ||
      ['failed', 'unknown'].includes(file.uploadState) ||
      ['error', 'unknown'].includes(file.status))
  );
}

export function needsTracking(file) {
  return (
    file.mode === 'api' &&
    Boolean(file.remoteId) &&
    (['scanning', 'flagged'].includes(file.scanStatus) ||
      ['uploading', 'unknown'].includes(file.uploadState) ||
      file.reconciling === true)
  );
}

export function uploadStatus(state) {
  return { uploaded: 'success', failed: 'error', unknown: 'unknown', uploading: 'processing' }[
    state
  ];
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Metadata ${label} chưa hợp lệ`);
  return value;
}
function timestamp(value, label, optional = false) {
  if (optional && value == null) return null;
  if (
    typeof value !== 'string' ||
    !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error(`Metadata ${label} chưa hợp lệ`);
  }
  return Date.parse(value);
}

function summary(record) {
  const findingsCount = record.findings_count ?? 0;
  const findingTypes = record.finding_types ?? [];
  const statusReason = record.status_reason ?? null;
  if (
    !Number.isSafeInteger(findingsCount) ||
    findingsCount < 0 ||
    !Array.isArray(findingTypes) ||
    findingTypes.some((type) => typeof type !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(type)) ||
    (statusReason !== null && typeof statusReason !== 'string')
  ) {
    throw new Error('Tóm tắt kết quả quét chưa hợp lệ');
  }
  return {
    findingsCount,
    findingTypes: [...new Set(findingTypes)],
    statusReason,
    scannedAt: timestamp(record.scanned_at, 'thời gian quét', true),
    quarantinedAt: timestamp(record.quarantined_at, 'thời gian cách ly', true),
  };
}

export function normalizeStatus(record, source = 'status') {
  if (!object(record)) throw new Error('Phản hồi trạng thái tệp chưa hợp lệ');
  const remoteId = text(record.id, 'ID tệp');
  if (
    !Object.hasOwn(scanStates, record.scan_status) ||
    !uploadStates.includes(record.upload_state)
  ) {
    throw new Error('Máy chủ trả trạng thái xử lý chưa được hỗ trợ');
  }
  return {
    remoteId,
    updatedAt: timestamp(record.updated_at, 'thời gian cập nhật'),
    uploadState: record.upload_state,
    scanStatus: record.scan_status,
    status: uploadStatus(record.upload_state),
    progress: record.upload_state === 'uploaded' ? 100 : 0,
    statusSource: source,
    ...summary(record),
  };
}

export function normalizeServerFile(record) {
  const state = normalizeStatus(record, 'list');
  const name = text(record.original_name, 'tên tệp');
  const type = text(record.content_type, 'định dạng tệp');
  const key = text(record.key, 'object key');
  text(record.owner_id, 'owner');
  if (
    !Number.isSafeInteger(record.size_bytes) ||
    record.size_bytes <= 0 ||
    !['local', 's3'].includes(record.storage)
  ) {
    throw new Error('Metadata dung lượng hoặc nơi lưu chưa hợp lệ');
  }
  return {
    ...state,
    id: `server:${state.remoteId}`,
    name,
    size: record.size_bytes,
    type,
    key,
    storage: record.storage,
    createdAt: timestamp(record.created_at, 'thời gian tạo'),
    mode: 'api',
    origin: 'server',
    serverOnly: true,
    starred: false,
  };
}

function sameIdentity(a, b) {
  return (
    Boolean(a.remoteId && b.remoteId && String(a.remoteId) === String(b.remoteId)) &&
    (!a.scope || !b.scope || a.scope === b.scope)
  );
}

export function mergeServerFiles(current, incoming, { replace = false } = {}) {
  const merged = replace
    ? current.filter(
        (file) =>
          file.original ||
          file.origin !== 'server' ||
          incoming.some((item) => sameIdentity(item, file)),
      )
    : [...current];
  for (const record of incoming) {
    const index = merged.findIndex((file) => sameIdentity(file, record));
    if (index < 0) {
      // Status endpoints return patches, not enough metadata to create a new library row.
      if (record.name && record.id) merged.push(record);
      continue;
    }
    const previous = merged[index];
    const older =
      Number.isFinite(previous.updatedAt) &&
      Number.isFinite(record.updatedAt) &&
      record.updatedAt < previous.updatedAt;
    const lowerPriority =
      record.updatedAt === previous.updatedAt &&
      previous.statusSource === 'status' &&
      record.statusSource !== 'status';
    if (older || lowerPriority) continue;
    const liveTransfer =
      Boolean(previous.original) && ['queued', 'uploading'].includes(previous.status);
    merged[index] = {
      ...previous,
      ...record,
      id: previous.id,
      original: previous.original,
      starred: previous.starred,
      connection: previous.connection ?? record.connection,
      scope: previous.scope ?? record.scope,
      origin: previous.origin ?? record.origin,
      serverOnly: !previous.original,
      ...(liveTransfer
        ? { status: previous.status, progress: previous.progress, error: previous.error }
        : {}),
      ...(record.uploadState === 'uploaded'
        ? { reconciling: false, outcomeUnknown: false, error: liveTransfer ? previous.error : null }
        : record.uploadState === 'failed'
          ? {
              reconciling: false,
              outcomeUnknown: false,
              retryable: Boolean(previous.original) && !previous.validationError,
            }
          : {}),
    };
  }
  return merged;
}

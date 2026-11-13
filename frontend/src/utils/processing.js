export const scanStates = {
  not_started: { label: 'Chưa quét', tone: 'muted' },
  scanning: { label: 'Đang quét', tone: 'uploading' },
  safe: {
    label: 'Không phát hiện',
    tone: 'success',
    description: 'Không phát hiện dữ liệu nhạy cảm. Không phải kết quả kiểm tra mã độc.',
  },
  flagged: {
    label: 'Chờ cách ly',
    tone: 'warning',
    description: 'Có dữ liệu nhạy cảm, đang chờ cách ly.',
  },
  quarantined: { label: 'Đã cách ly', tone: 'warning' },
  restored: {
    label: 'Đã khôi phục',
    tone: 'success',
    description: 'Quản trị viên đã khôi phục quyền xem và tải. Kết quả quét ban đầu vẫn được lưu.',
  },
  quarantine_delete_failed: {
    label: 'Cách ly lỗi',
    tone: 'error',
    description: 'Đã sao chép cách ly nhưng chưa xóa được bản nguồn.',
  },
  unscanned: { label: 'Chưa thể quét', tone: 'warning' },
  error: { label: 'Quét lỗi', tone: 'error' },
};

export function scanState(file) {
  if (
    file?.scanStatus === 'flagged' &&
    (file.statusReason?.startsWith('quarantine_') ||
      ['kms_key_arn_or_id_required', 'source_size_mismatch', 'source_missing_without_copy_record',
        'completed_source_still_exists'].includes(file.statusReason))
  ) {
    return { label: 'Cách ly thất bại', tone: 'error' };
  }
  return scanStates[file?.scanStatus];
}

const scanReasons = {
  text_decode_failed: 'Không đọc được bảng mã văn bản.',
  pdf_password_protected: 'PDF được bảo vệ bằng mật khẩu nên chưa đọc được.',
  pdf_invalid: 'PDF bị hỏng hoặc không đọc được cấu trúc.',
  pdf_parser_unavailable: 'Bộ quét thiếu thư viện đọc PDF. Cần cập nhật gói Lambda.',
  pdf_crypto_unavailable: 'Bộ quét thiếu thư viện giải mã PDF. Cần cập nhật gói Lambda.',
  image_decoder_unavailable: 'Bộ quét thiếu thư viện đọc ảnh GIF/WebP. Cần cập nhật gói Lambda.',
  image_invalid: 'Ảnh bị hỏng hoặc không đọc được cấu trúc.',
  ocr_document_unreadable: 'Dịch vụ OCR không đọc được tài liệu này.',
  ocr_failed: 'Tác vụ OCR không hoàn tất thành công.',
  ocr_access_denied: 'Bộ quét chưa có quyền gọi OCR. Cần kiểm tra quyền Amazon Textract.',
  ocr_source_unavailable: 'OCR chưa đọc được bản nguồn. Cần kiểm tra quyền S3/KMS và vùng AWS.',
  ocr_kms_unavailable: 'OCR chưa sử dụng được khóa mã hóa của tệp nguồn.',
  ocr_invalid_request: 'Yêu cầu OCR chưa hợp lệ. Cần kiểm tra cấu hình xử lý.',
  ocr_document_too_large: 'Tài liệu vượt giới hạn xử lý của dịch vụ OCR.',
  ocr_throttled: 'Dịch vụ OCR đang giới hạn lượt xử lý. Có thể yêu cầu quét lại sau.',
  ocr_unavailable: 'Chưa kết nối được dịch vụ OCR. Có thể yêu cầu quét lại sau.',
  empty_file: 'Tệp rỗng, không có nội dung để kiểm tra.',
  image_too_large: 'Ảnh vượt giới hạn dung lượng OCR.',
  source_size_mismatch: 'Dung lượng tệp nguồn không khớp dữ liệu đã lưu.',
  source_missing_without_copy_record: 'Không tìm thấy bản nguồn và chưa có bằng chứng bản cách ly.',
  completed_source_still_exists: 'Đã ghi nhận cách ly nhưng bản nguồn vẫn còn. Cần kiểm tra lại.',
  unsupported_type: 'Chưa hỗ trợ định dạng này.',
  unsupported_type_or_size: 'Định dạng hoặc dung lượng chưa hỗ trợ.',
  file_too_large: 'Tệp vượt giới hạn quét.',
  unreadable_document: 'Không đọc được tệp, tệp hỏng hoặc có mật khẩu.',
  scan_failed: 'Quét thất bại. Cần kiểm tra dịch vụ xử lý.',
  quarantine_delete_failed: 'Chưa xóa được bản nguồn sau khi cách ly.',
  quarantine_copy_failed: 'Chưa sao chép được tệp sang kho cách ly.',
  quarantine_read_failed: 'Chưa đọc hoặc đối chiếu được tệp trong quá trình cách ly.',
  quarantine_failed: 'Cách ly chưa hoàn tất. Cần kiểm tra bước xử lý bị lỗi.',
  quarantine_prepare_failed: 'Chưa chuẩn bị được trạng thái cách ly. Cần kiểm tra quyền ghi metadata.',
  quarantine_size_mismatch: 'Dung lượng bản cách ly không khớp tệp nguồn.',
  quarantine_kms_mismatch: 'Mã hóa bản cách ly chưa khớp khóa KMS được cấu hình.',
  quarantine_configuration_incomplete: 'Cấu hình kho cách ly hoặc khóa mã hóa chưa đầy đủ.',
  quarantine_bucket_mismatch: 'Kho cách ly chưa khớp cấu hình xử lý.',
  kms_key_arn_or_id_required: 'Chưa cấu hình đúng định danh khóa mã hóa KMS.',
  storage_unconfirmed: 'Chưa xác nhận lưu tệp.',
  storage_unavailable: 'Lưu trữ chưa sẵn sàng.',
  initial_audit_unconfirmed: 'Chưa xác nhận lịch sử tải lên.',
  ocr_no_text: 'OCR chưa đọc được chữ trong tệp.',
  ocr_incomplete: 'OCR chưa đọc đủ nội dung hoặc số trang.',
  ocr_timeout: 'OCR quá thời gian xử lý.',
  scan_crashed: 'Dịch vụ quét bị gián đoạn.',
  execution_failed: 'Lượt quét trên AWS đã kết thúc với lỗi.',
  execution_result_missing: 'Lượt quét đã kết thúc nhưng MâySec chưa ghi nhận được kết quả.',
  rescan_start_failed: 'Chưa khởi chạy được lượt quét lại.',
  scan_detail_unavailable: 'Máy chủ chưa cung cấp lý do có thể hiển thị.',
  quota_exceeded: 'Không đủ dung lượng theo hạn mức tài khoản.',
};
export function scanExplanation(file) {
  if (file?.statusReason && !scanReasons[file.statusReason] &&
      ['error', 'unscanned'].includes(file.scanStatus)) {
    return 'Bộ quét trả về lý do chưa được giao diện hỗ trợ. Cần cập nhật giao diện để xem giải thích.';
  }
  return (
    scanReasons[file?.statusReason] ||
    scanStates[file?.scanStatus]?.description ||
    {
      not_started: 'Tệp chưa được quét.',
      scanning: 'Đang chờ hoặc đang quét dữ liệu nhạy cảm.',
      quarantined: 'Tệp đã được cách ly. Không thể xem hoặc tải nội dung.',
      unscanned: 'Báo cáo lượt quét này chưa ghi nhận lý do cụ thể. Cần quét lại sau khi cập nhật bộ quét.',
      error: 'Lượt quét gặp lỗi nhưng báo cáo chưa ghi nhận lý do cụ thể. Cần quét lại sau khi cập nhật bộ quét.',
    }[file?.scanStatus] ||
    'Chưa có kết quả quét.'
  );
}

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
    (needsCompression(file) ||
      attentionStates.has(file.scanStatus) ||
      ['failed', 'unknown'].includes(file.uploadState) ||
      ['error', 'unknown'].includes(file.status))
  );
}

export function needsCompression(file) {
  return Boolean(
    file?.compressionRequestedAt &&
    !file.compressionResolvedAt &&
    (!file.lifecycleState || file.lifecycleState === 'active'),
  );
}

export function needsTracking(file) {
  return (
    file.mode === 'api' &&
    (!file.lifecycleState || file.lifecycleState === 'active') &&
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
    rescanRequestedAt: timestamp(record.rescan_requested_at, 'thời gian quét lại', true),
    scanStartedAt: timestamp(record.scan_started_at, 'thời gian bắt đầu quét', true),
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
    ...fileEdits(record),
    updatedAt: timestamp(record.updated_at, 'thời gian cập nhật'),
    uploadState: record.upload_state,
    scanStatus: record.scan_status,
    status: uploadStatus(record.upload_state),
    progress: record.upload_state === 'uploaded' ? 100 : 0,
    statusSource: source,
    ...summary(record),
  };
}

function fileEdits(record) {
  const result = {};
  if (record.compression_requested_at) {
    result.compressionRequestedAt = timestamp(
      record.compression_requested_at,
      'thời gian yêu cầu nén',
    );
    result.compressionResolvedAt = timestamp(
      record.compression_resolved_at,
      'thời gian xử lý yêu cầu nén',
      true,
    );
  }
  if (record.folder_updated_at) {
    result.folderId = record.folder_id ?? null;
    result.folderUpdatedAt = timestamp(record.folder_updated_at, 'thời gian chuyển thư mục');
  }
  if (record.lifecycle_state != null) {
    if (!['active', 'trashed', 'deleting', 'purged'].includes(record.lifecycle_state))
      throw new Error('Trạng thái Thùng rác chưa hợp lệ');
    result.lifecycleState = record.lifecycle_state;
    result.trashRootId = record.trash_root_id ?? null;
    result.lifecycleUpdatedAt =
      timestamp(record.lifecycle_updated_at, 'thời gian thay đổi tệp', true) || 0;
    result.trashedAt = timestamp(record.trashed_at, 'thời gian xóa', true);
    result.trashExpiresAt = timestamp(record.trash_expires_at, 'thời hạn khôi phục', true);
  }
  if (record.name_updated_at) {
    result.nameUpdatedAt = timestamp(record.name_updated_at, 'thời gian đổi tên');
    if (record.display_name) result.name = text(record.display_name, 'tên hiển thị');
  }
  return result;
}

export function normalizeServerFile(record) {
  const state = normalizeStatus(record, 'list');
  const name = text(record.original_name, 'tên tệp');
  const type = text(record.content_type, 'định dạng tệp');
  const key = text(record.key, 'object key');
  text(record.owner_id, 'owner');
  if (record.starred !== undefined && typeof record.starred !== 'boolean')
    throw new Error('Đánh dấu chưa hợp lệ');
  if (
    !Number.isSafeInteger(record.size_bytes) ||
    record.size_bytes < 0 ||
    (record.size_bytes === 0 && state.lifecycleState !== 'purged') ||
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
    starred: record.starred ?? false,
    starredUpdatedAt: timestamp(record.starred_updated_at, 'thời gian đánh dấu', true) ?? 0,
  };
}

function sameIdentity(a, b) {
  return (
    Boolean(a.remoteId && b.remoteId && String(a.remoteId) === String(b.remoteId)) &&
    (!a.scope || !b.scope || a.scope === b.scope)
  );
}

export function isStaleFileStatus(previous, record) {
  if (
    Object.hasOwn(scanStates, previous.scanStatus) &&
    Object.hasOwn(scanStates, record.scanStatus)
  ) {
    const previousAttempt = previous.rescanRequestedAt ?? 0;
    const nextAttempt = record.rescanRequestedAt ?? 0;
    if (previousAttempt !== nextAttempt) return nextAttempt < previousAttempt;
    if (previous.scanStatus === 'restored' && record.scanStatus === 'quarantined') return true;
    if (previous.scanStatus === 'quarantined' && record.scanStatus === 'restored') return false;

    // FastAPI and Lambda have separate clocks. Within a scan attempt, a
    // persisted result takes precedence over an upload or pending snapshot.
    const previousPending = ['not_started', 'scanning'].includes(previous.scanStatus);
    const nextPending = ['not_started', 'scanning'].includes(record.scanStatus);
    if (previousPending && !nextPending && Number.isFinite(record.scannedAt)) return false;
    if (nextPending && !previousPending && Number.isFinite(previous.scannedAt)) return true;
    if (previousPending && nextPending) {
      const previousStarted = Number.isFinite(previous.scanStartedAt);
      const nextStarted = Number.isFinite(record.scanStartedAt);
      if (previousStarted !== nextStarted) return previousStarted;
    }
  }
  return (
    (Number.isFinite(previous.updatedAt) &&
      Number.isFinite(record.updatedAt) &&
      record.updatedAt < previous.updatedAt) ||
    (record.updatedAt === previous.updatedAt &&
      previous.statusSource === 'status' &&
      record.statusSource !== 'status')
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
    // An archived file ID cannot become live again through a delayed list/poll.
    if (previous.lifecycleState === 'purged' && record.lifecycleState !== 'purged') continue;
    const erasedPatch =
      record.lifecycleState === 'purged'
        ? {
            lifecycleState: 'purged',
            lifecycleUpdatedAt: Math.max(
              record.lifecycleUpdatedAt || 0,
              previous.lifecycleUpdatedAt || 0,
            ),
            original: undefined,
            retryable: false,
          }
        : {};
    const starPatch =
      typeof record.starred === 'boolean' &&
      ((record.starredUpdatedAt || 0) > (previous.starredUpdatedAt || 0) ||
        (!previous.original && (record.starredUpdatedAt || 0) >= (previous.starredUpdatedAt || 0)))
        ? { starred: record.starred, starredUpdatedAt: record.starredUpdatedAt || 0 }
        : {
            starred: previous.starred,
            starredUpdatedAt: previous.starredUpdatedAt || 0,
          };
    const editPatch = {};
    for (const [stamp, keys] of [
      ['lifecycleUpdatedAt', ['lifecycleState', 'trashedAt', 'trashExpiresAt', 'trashRootId']],
      ['nameUpdatedAt', ['name']],
      ['folderUpdatedAt', ['folderId']],
    ]) {
      const source =
        (record[stamp] || 0) >= (previous[stamp] || 0) && record[stamp] != null ? record : previous;
      for (const key of [stamp, ...keys])
        if (source[key] !== undefined) editPatch[key] = source[key];
    }
    // Each file has one compression request. A response read before it was
    // closed cannot reopen it, even if both requests share a timestamp.
    const compression =
      record.compressionRequestedAt &&
      (!previous.compressionResolvedAt || record.compressionResolvedAt)
        ? record
        : previous;
    if (compression.compressionRequestedAt) {
      editPatch.compressionRequestedAt = compression.compressionRequestedAt;
      editPatch.compressionResolvedAt = compression.compressionResolvedAt;
    }
    if (isStaleFileStatus(previous, record)) {
      merged[index] = { ...previous, ...starPatch, ...editPatch, ...erasedPatch };
      continue;
    }
    const liveTransfer =
      Boolean(previous.original) && ['queued', 'uploading'].includes(previous.status);
    merged[index] = {
      ...previous,
      ...record,
      id: previous.id,
      original: previous.original,
      ...starPatch,
      ...editPatch,
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
      ...erasedPatch,
    };
  }
  return merged;
}

import {
  normalizeServerFile,
  normalizeStatus,
  scanStates,
  uploadStates,
} from '../utils/processing.js';
import { DOWNLOAD_LIMIT } from '../utils/content.js';
import { MB } from '../utils/files.js';

export class ApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ApiError';
    Object.assign(this, details);
  }
}

// Kiểm tra địa chỉ backend trước khi gửi tệp.
export function validateApiBaseUrl(value, pageProtocol = globalThis.location?.protocol) {
  if (!value?.trim()) throw new Error('Nhập địa chỉ backend để bắt đầu kết nối');
  const url = new URL(value.trim());
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Dùng URL HTTP/HTTPS, không chứa thông tin đăng nhập, query hoặc fragment');
  }
  if (pageProtocol === 'https:' && url.protocol !== 'https:') {
    throw new Error('Trang HTTPS cần kết nối tới backend HTTPS');
  }

  return url.href.replace(/\/$/, '');
}

// Chuẩn hóa phản hồi thành thông tin tệp đã được backend xác nhận.
export function parseUploadResponse(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('API chưa trả về JSON hợp lệ — kiểm tra địa chỉ backend và route /upload');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Phản hồi tải lên không hợp lệ');
  }
  if (data.success === false || data.error) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Backend báo tải lên thất bại');
  }

  const result = data.file ?? data;
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new Error('Thông tin tải lên chưa hợp lệ');
  const id = result.id ?? result.file_id;
  const key = result.key ?? result.s3_key;
  if (typeof id !== 'string' && typeof id !== 'number' && typeof key !== 'string') {
    throw new Error('API cần trả về id hoặc key của tệp đã lưu');
  }
  if (!id && !key) throw new Error('API chưa xác nhận tệp đã được lưu');
  if (result.storage != null && !['local', 's3'].includes(result.storage)) {
    throw new Error('API trả về loại lưu trữ chưa được hỗ trợ');
  }
  if (result.scan_status != null && !Object.hasOwn(scanStates, result.scan_status))
    throw new Error('API trả trạng thái quét chưa được hỗ trợ');
  if (result.upload_state != null && !uploadStates.includes(result.upload_state))
    throw new Error('API trả trạng thái tải lên chưa được hỗ trợ');
  const parsed = {
    id,
    key,
    storage: result.storage ?? 'unspecified',
    scanStatus: result.scan_status ?? 'unknown',
  };
  if (result.upload_state != null) parsed.uploadState = result.upload_state;
  if (result.created_at != null) {
    const date = Date.parse(result.created_at);
    if (
      typeof result.created_at !== 'string' ||
      !/(?:Z|[+-]\d{2}:\d{2})$/i.test(result.created_at) ||
      !Number.isFinite(date)
    )
      throw new Error('Thời gian tải lên chưa hợp lệ');
    parsed.createdAt = date;
  }
  return parsed;
}

// Ưu tiên thông báo lỗi từ backend, sau đó dùng mã HTTP.
function apiError(xhr) {
  try {
    const data = JSON.parse(xhr.responseText);
    const message = data.message ?? data.detail ?? data.error;
    if (typeof message === 'string') return message;
  } catch {
    /* Return a concise HTTP message for non-JSON responses. */
  }
  return `Tải lên thất bại (HTTP ${xhr.status}) — vui lòng thử lại`;
}

// Tải thật qua API: theo dõi tiến độ, hủy và xử lý lỗi.
export function uploadFile(
  file,
  { baseUrl, signal, onProgress = () => {}, xhrFactory = () => new XMLHttpRequest() },
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Đã hủy tải lên', 'AbortError'));
    let endpoint;
    try {
      endpoint = `${validateApiBaseUrl(baseUrl)}/upload`;
    } catch (error) {
      reject(error);
      return;
    }
    const xhr = xhrFactory();
    const abort = () => xhr.abort();
    const cleanup = () => signal?.removeEventListener('abort', abort);
    xhr.open('POST', endpoint);
    xhr.timeout = 300_000;
    // Same-origin cookies are sent normally. Cross-origin credentials need a future auth integration.
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      }
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status < 200 || xhr.status >= 300) {
        const error = uploadError(xhr, apiError(xhr));
        reject(error);
        return;
      }
      try {
        resolve(parseUploadResponse(xhr.responseText));
      } catch (error) {
        // A successful HTTP write with an unreadable confirmation must not be silently resent.
        reject(uploadError(xhr, error.message, true));
      }
    };
    xhr.onerror = () => {
      cleanup();
      reject(
        uploadError(
          xhr,
          'Không kết nối được backend — kiểm tra địa chỉ API, mạng và cấu hình CORS',
          true,
        ),
      );
    };
    xhr.ontimeout = () => {
      cleanup();
      reject(
        uploadError(
          xhr,
          'Backend phản hồi quá lâu — hãy kiểm tra tệp trên máy chủ trước khi thử lại',
          true,
        ),
      );
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException('Đã hủy tải lên', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    const body = new FormData();
    body.append('file', file, file.name);
    // Let the browser set the multipart boundary; never place AWS credentials in the client.
    xhr.send(body);
  });
}

function uploadError(xhr, message, uncertain = false) {
  const remoteId = xhr.getResponseHeader?.('X-File-Id')?.trim() || null;
  const key = xhr.getResponseHeader?.('X-File-Key')?.trim() || null;
  const outcomeUnknown = uncertain || Boolean(remoteId);
  return new ApiError(message, {
    status: xhr.status || 0,
    remoteId,
    key,
    outcomeUnknown,
    reconciling: Boolean(remoteId),
    retryable: !outcomeUnknown && (xhr.status >= 500 || [408, 429].includes(xhr.status)),
  });
}

async function requestJson(
  baseUrl,
  path,
  { signal, timeout = 10000, fetcher = globalThis.fetch, method = 'GET', body } = {},
) {
  const base = validateApiBaseUrl(baseUrl);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) throw new DOMException('Đã hủy yêu cầu', 'AbortError');
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeout);
  try {
    const response = await fetcher(`${base}${path}`, {
      signal: controller.signal,
      method,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let data;
    try {
      data = await response.json();
    } catch {
      if (!response.ok)
        throw new ApiError(`Máy chủ trả HTTP ${response.status}`, { status: response.status });
      throw new ApiError('Máy chủ chưa trả JSON hợp lệ', {
        status: response.status,
        code: 'invalid_response',
      });
    }
    if (!response.ok)
      throw new ApiError(
        typeof data?.detail === 'string' ? data.detail : `Máy chủ trả HTTP ${response.status}`,
        { status: response.status },
      );
    return data;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Đã hủy yêu cầu', 'AbortError');
    if (controller.signal.aborted)
      throw new ApiError('Máy chủ chưa phản hồi — hãy kiểm tra lại kết nối', {
        status: 0,
        code: 'timeout',
      });
    if (error instanceof ApiError) throw error;
    throw new ApiError('Không kết nối được máy chủ — kiểm tra mạng và CORS', {
      status: 0,
      code: 'network',
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export async function listFiles(
  baseUrl,
  { cursor, limit = 100, area, path = '/files', signal, timeout, fetcher } = {},
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new RangeError('Giới hạn danh sách phải từ 1 đến 100');
  if (cursor != null && (typeof cursor !== 'string' || !cursor.length || cursor.length > 2048))
    throw new Error('Cursor danh sách chưa hợp lệ');
  const query = new URLSearchParams({ limit: String(limit) });
  if (area) query.set('area', area);
  if (cursor != null) query.set('cursor', cursor);
  const data = await requestJson(baseUrl, `${path}?${query}`, { signal, timeout, fetcher });
  if (
    !data ||
    typeof data !== 'object' ||
    !Array.isArray(data.items) ||
    (data.next_cursor != null &&
      (typeof data.next_cursor !== 'string' ||
        !data.next_cursor.length ||
        data.next_cursor.length > 2048))
  ) {
    throw new ApiError('Danh sách tệp trả về chưa đúng định dạng', { code: 'invalid_response' });
  }
  const items = [];
  const skippedItems = [];
  for (const record of data.items) {
    try {
      items.push(normalizeServerFile(record));
    } catch (error) {
      // Keep invalid metadata out of file actions without losing the rest of the page.
      skippedItems.push({
        id: typeof record?.id === 'string' ? record.id.slice(0, 160) : null,
        name: typeof record?.original_name === 'string' ? record.original_name.slice(0, 200) : null,
        reason: error instanceof Error ? error.message : 'Metadata của tệp chưa hợp lệ',
      });
    }
  }
  return { items, skippedItems, nextCursor: data.next_cursor ?? null };
}

export async function changeFile(baseUrl, id, action, body, options = {}) {
  const method = action === 'purge' ? 'DELETE' : action === 'name' ? 'PATCH' : 'POST';
  const data = await requestJson(
    baseUrl,
    `/files/${encodeURIComponent(id)}${action === 'purge' ? '' : `/${action}`}`,
    { ...options, method, body, timeout: action === 'purge' ? 60000 : 10000 },
  );
  if (action === 'purge') {
    if (data?.id !== id || data.deleted !== true) throw new ApiError('Chưa xác nhận xóa tệp');
    return data;
  }
  const result = normalizeServerFile(data);
  if (result.remoteId !== id) throw new ApiError('ID tệp thay đổi không khớp');
  return result;
}

export async function listNotifications(baseUrl, options = {}) {
  const records = [],
    seen = new Set();
  let cursor;
  do {
    const query = new URLSearchParams({ limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const data = await requestJson(baseUrl, `/notifications?${query}`, options);
    if (!Array.isArray(data?.items)) throw new ApiError('Thông báo chưa đúng định dạng');
    records.push(...data.items);
    cursor = data.next_cursor;
    if (
      cursor != null &&
      (typeof cursor !== 'string' || !cursor.length || cursor.length > 2048 || seen.has(cursor))
    )
      throw new ApiError('Cursor thông báo chưa hợp lệ');
    if (cursor) seen.add(cursor);
  } while (options.includeHistory && cursor && records.length < 2000);
  return records
    .slice(0, 2000)
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      message: item.message,
      tone: item.tone,
      fileId: item.file_id,
      createdAt: Date.parse(item.created_at),
      read: item.read === true,
    }))
    .filter((item) => typeof item.id === 'string' && Number.isFinite(item.createdAt));
}

export function persistNotification(baseUrl, event, options = {}) {
  return requestJson(baseUrl, '/notifications', {
    ...options,
    method: 'POST',
    body: {
      id: event.id,
      kind: event.kind,
      title: event.title.slice(0, 200),
      message: (event.message || '').slice(0, 1000),
      tone: event.tone || 'info',
      file_id: event.fileId || null,
      read: event.read === true,
      created_at: new Date(event.createdAt).toISOString(),
    },
  });
}

export async function getFileStatus(baseUrl, id, options = {}) {
  if (typeof id !== 'string' || !id.trim()) throw new Error('ID tệp chưa hợp lệ');
  const data = await requestJson(baseUrl, `/files/${encodeURIComponent(id)}/status`, options);
  try {
    const result = normalizeStatus(data);
    if (result.remoteId !== id) throw new Error('ID trạng thái không khớp tệp yêu cầu');
    return result;
  } catch (error) {
    throw new ApiError(error.message, { code: 'invalid_response' });
  }
}

export async function getStorageUsage(baseUrl, options = {}) {
  const data = await requestJson(baseUrl, '/storage/usage', options);
  if (
    !data ||
    ['limit_bytes', 'used_bytes', 'reserved_bytes', 'available_bytes'].some(
      (key) => !Number.isSafeInteger(data[key]) || data[key] < 0,
    ) ||
    data.limit_bytes !== 1_000_000_000 ||
    data.available_bytes !== Math.max(0, data.limit_bytes - data.used_bytes - data.reserved_bytes)
  )
    throw new ApiError('Dung lượng trả về chưa hợp lệ', { code: 'invalid_response' });
  return {
    limit: data.limit_bytes,
    used: data.used_bytes,
    reserved: data.reserved_bytes,
    available: data.available_bytes,
  };
}

function parseScanReport(data, id) {
  const status = normalizeStatus(data);
  if (
    status.remoteId !== id ||
    !Array.isArray(data.finding_counts) ||
    data.finding_counts.some(
      (entry) =>
        !entry ||
        !/^[A-Z][A-Z0-9_]{0,63}$/.test(entry.type) ||
        !Number.isSafeInteger(entry.count) ||
        entry.count < 0,
    ) ||
    typeof data.counts_complete !== 'boolean' ||
    (data.extraction_complete != null && typeof data.extraction_complete !== 'boolean') ||
    (data.scan_reason != null && typeof data.scan_reason !== 'string') ||
    (data.rescan_dispatch != null &&
      !['pending', 'started', 'unknown', 'failed'].includes(data.rescan_dispatch))
  )
    throw new ApiError('Báo cáo quét trả về chưa hợp lệ', { code: 'invalid_response' });
  if (
    new Set(data.finding_counts.map((entry) => entry.type)).size !== data.finding_counts.length ||
    (data.counts_complete &&
      data.finding_counts.reduce((sum, entry) => sum + entry.count, 0) !== status.findingsCount) ||
    (data.rescan_request_id != null &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        data.rescan_request_id,
      )) ||
    (data.rescan_requested_at != null && !Number.isFinite(Date.parse(data.rescan_requested_at)))
  )
    throw new ApiError('Báo cáo quét trả về chưa hợp lệ', { code: 'invalid_response' });
  return {
    ...status,
    findingCounts: data.finding_counts,
    countsComplete: data.counts_complete,
    extractionComplete: data.extraction_complete ?? null,
    scanReason: data.scan_reason ?? null,
    rescanRequestedAt: data.rescan_requested_at ?? null,
    rescanRequestId: data.rescan_request_id ?? null,
    rescanDispatch: data.rescan_dispatch ?? null,
  };
}

export async function getScanReport(baseUrl, id, options = {}) {
  const data = await requestJson(baseUrl, `/files/${encodeURIComponent(id)}/scan-report`, options);
  return parseScanReport(data, id);
}

export async function rescanFile(baseUrl, id, requestId, options = {}) {
  const data = await requestJson(baseUrl, `/files/${encodeURIComponent(id)}/rescan`, {
    ...options,
    method: 'POST',
    body: { request_id: requestId },
    timeout: 30000,
  });
  return parseScanReport(data, id);
}

export async function updateFilePreferences(baseUrl, id, starred, options = {}) {
  if (typeof id !== 'string' || !id.trim() || typeof starred !== 'boolean')
    throw new Error('Tùy chọn tệp chưa hợp lệ');
  const data = await requestJson(baseUrl, `/files/${encodeURIComponent(id)}/preferences`, {
    ...options,
    method: 'PATCH',
    body: { starred },
  });
  const at = Date.parse(data?.starred_updated_at);
  if (
    data?.id !== id ||
    data?.starred !== starred ||
    !Number.isFinite(at) ||
    !/(Z|[+-]\d{2}:\d{2})$/.test(data.starred_updated_at)
  )
    throw new ApiError('Máy chủ chưa xác nhận đánh dấu', { code: 'invalid_response' });
  return { remoteId: id, starred, starredUpdatedAt: at };
}

const previewByteLimits = {
  __proto__: null,
  'image/png': 10 * MB,
  'image/jpeg': 10 * MB,
  'image/gif': 10 * MB,
  'image/webp': 10 * MB,
  'application/pdf': 20 * MB,
  'text/plain': MB,
  'text/csv': MB,
  'application/json': MB,
};

async function readBrowserContent(reader, { id, mode, signal }) {
  const invalid = () =>
    new ApiError('Dữ liệu tệp trả về chưa hợp lệ', { code: 'invalid_response' });
  const tooLarge = () => new ApiError('Nội dung vượt giới hạn đọc', { status: 413 });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const chunks = [];
  let pending = '',
    metadata = null,
    ended = false,
    length = 0,
    wireLength = 0;
  let limit = mode === 'download' ? DOWNLOAD_LIMIT : 20 * MB;
  const maxLine = 96 * 1024;
  function consume(line) {
    if (line.length > maxLine) throw tooLarge();
    if (!line.trim()) return;
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      throw invalid();
    }
    if (!frame || ended) throw invalid();
    if (!metadata) {
      if (
        frame.kind !== 'metadata' ||
        frame.id !== id ||
        typeof frame.content_type !== 'string' ||
        !Number.isSafeInteger(frame.size_bytes) ||
        frame.size_bytes <= 0
      )
        throw invalid();
      const type = frame.content_type.split(';')[0].trim().toLowerCase();
      limit = mode === 'download' ? DOWNLOAD_LIMIT : previewByteLimits[type] || 0;
      if (!limit) throw new ApiError('Định dạng chưa hỗ trợ xem trước', { status: 415 });
      if (frame.size_bytes > limit) throw tooLarge();
      metadata = {
        type: mode === 'download' ? 'application/octet-stream' : type,
        size: frame.size_bytes,
      };
      return;
    }
    if (frame.kind === 'end') {
      if (length !== metadata.size) throw invalid();
      ended = true;
      return;
    }
    if (
      frame.kind !== 'data' ||
      typeof frame.data !== 'string' ||
      !frame.data.length ||
      frame.data.length > 65536 ||
      frame.data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(frame.data)
    )
      throw invalid();
    let decoded;
    try {
      decoded = atob(frame.data);
    } catch {
      throw invalid();
    }
    length += decoded.length;
    if (length > limit || length > metadata.size) throw tooLarge();
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
    chunks.push(bytes);
  }
  try {
    while (true) {
      signal.throwIfAborted();
      const result = await reader.read();
      if (result.done) break;
      wireLength += result.value.byteLength;
      if (wireLength > Math.ceil(limit * 1.4) + 8192) throw tooLarge();
      pending += decoder.decode(result.value, { stream: true });
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        consume(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
      }
      if (pending.length > maxLine) throw tooLarge();
    }
    pending += decoder.decode();
    if (pending.trim()) consume(pending);
    signal.throwIfAborted();
    if (!metadata || !ended) throw invalid();
    return new Blob(chunks, { type: metadata.type });
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof ApiError || error.name === 'AbortError') throw error;
    throw invalid();
  }
}

export async function getFileContent(
  baseUrl,
  id,
  { mode = 'download', signal, timeout = 60000, fetcher = globalThis.fetch } = {},
) {
  if (typeof id !== 'string' || !id.trim() || !['preview', 'download'].includes(mode))
    throw new Error('Yêu cầu nội dung chưa hợp lệ');
  const controller = new AbortController();
  if (signal?.aborted) throw new DOMException('Đã hủy yêu cầu', 'AbortError');
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeout);
  let reader;
  try {
    const response = await fetcher(
      `${validateApiBaseUrl(baseUrl)}/files/${encodeURIComponent(id)}/content?mode=${mode}`,
      {
        signal: controller.signal,
        cache: 'no-store',
        headers: { Accept: 'application/x-ndjson' },
      },
    );
    if (!response.ok) {
      let detail;
      try {
        detail = (await response.json()).detail;
      } catch {}
      throw new ApiError(
        typeof detail === 'string' ? detail : `Không đọc được tệp (HTTP ${response.status})`,
        { status: response.status },
      );
    }
    const type = (response.headers.get('Content-Type') || 'application/octet-stream')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (type === 'application/x-ndjson') {
      if (!response.body?.getReader)
        throw new ApiError('Trình duyệt chưa hỗ trợ đọc luồng nội dung', { code: 'unsupported' });
      reader = response.body.getReader();
      return await readBrowserContent(reader, { id, mode, signal: controller.signal });
    }
    // Older backends still return bounded raw bytes until they are restarted/upgraded.
    const limit = mode === 'download' ? DOWNLOAD_LIMIT : previewByteLimits[type] || 0;
    if (!limit) {
      await response.body?.cancel();
      throw new ApiError('Định dạng chưa hỗ trợ xem trước', { status: 415 });
    }
    if (Number(response.headers.get('Content-Length')) > limit) {
      await response.body?.cancel();
      throw new ApiError('Nội dung vượt giới hạn đọc', { status: 413 });
    }
    if (!response.body?.getReader) {
      const blob = await response.blob();
      if (blob.size > limit) throw new ApiError('Nội dung vượt giới hạn đọc', { status: 413 });
      return blob;
    }
    reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new ApiError('Nội dung vượt giới hạn đọc', { status: 413 });
      }
      chunks.push(result.value);
    }
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return new Blob(chunks, { type });
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Đã hủy yêu cầu', 'AbortError');
    if (controller.signal.aborted)
      throw new ApiError('Đọc tệp quá lâu — hãy thử lại', { code: 'timeout' });
    if (error instanceof ApiError) throw error;
    throw new ApiError('Không đọc được nội dung — kiểm tra mạng và CORS', { code: 'network' });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    reader?.releaseLock();
  }
}

// Chế độ trải nghiệm: mô phỏng tiến độ trong trình duyệt.
export function demoUpload(file, { signal, onProgress = () => {} }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Đã hủy tải lên', 'AbortError'));
    let progress = 0;
    const abort = () => {
      clearInterval(timer);
      signal?.removeEventListener('abort', abort);
      reject(new DOMException('Đã hủy tải lên', 'AbortError'));
    };
    const timer = setInterval(() => {
      progress = Math.min(100, progress + 14 + Math.random() * 12);
      onProgress(Math.round(progress));
      if (progress === 100) {
        clearInterval(timer);
        signal?.removeEventListener('abort', abort);
        resolve({ id: `demo-${crypto.randomUUID()}` });
      }
    }, 160);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function checkHealth(
  baseUrl,
  { signal, timeout = 5000, fetcher = globalThis.fetch } = {},
) {
  const url = validateApiBaseUrl(baseUrl);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetcher(`${url}/health`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Máy chủ trả HTTP ${response.status}`);
    const data = await response.json();
    if (
      data?.status !== 'ok' ||
      !['local', 's3', 'unconfigured'].includes(data.storage) ||
      typeof data.storage_configured !== 'boolean' ||
      !Number.isSafeInteger(data.max_file_size_bytes) ||
      data.max_file_size_bytes <= 0
    ) {
      throw new Error('Phản hồi kiểm tra kết nối chưa đúng định dạng MâySec');
    }
    return { ...data, baseUrl: url, checkedAt: Date.now() };
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted)
      throw new Error('Kiểm tra quá 5 giây — máy chủ chưa phản hồi');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

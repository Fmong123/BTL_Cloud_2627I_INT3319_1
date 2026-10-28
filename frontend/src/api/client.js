import {
  normalizeServerFile,
  normalizeStatus,
  scanStates,
  uploadStates,
} from '../utils/processing.js';
import { DOWNLOAD_LIMIT } from '../utils/content.js';

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
    throw new Error('Phản hồi upload không hợp lệ');
  }
  if (data.success === false || data.error) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Backend báo tải lên thất bại');
  }

  const result = data.file ?? data;
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new Error('Thông tin upload chưa hợp lệ');
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
    throw new Error('API trả trạng thái upload chưa được hỗ trợ');
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
      throw new Error('Thời gian upload chưa hợp lệ');
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

export async function listFiles(baseUrl, { cursor, limit = 100, signal, timeout, fetcher } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new RangeError('Giới hạn danh sách phải từ 1 đến 100');
  if (cursor != null && (typeof cursor !== 'string' || !cursor.length || cursor.length > 2048))
    throw new Error('Cursor danh sách chưa hợp lệ');
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor != null) query.set('cursor', cursor);
  const data = await requestJson(baseUrl, `/files?${query}`, { signal, timeout, fetcher });
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
  try {
    return { items: data.items.map(normalizeServerFile), nextCursor: data.next_cursor ?? null };
  } catch (error) {
    throw new ApiError(error.message, { code: 'invalid_response' });
  }
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
        headers: { Accept: '*/*' },
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
    const previewLimits = {
      'image/png': 10,
      'image/jpeg': 10,
      'image/gif': 10,
      'image/webp': 10,
      'application/pdf': 20,
      'text/plain': 1,
      'text/csv': 1,
      'application/json': 1,
    };
    const limit = mode === 'download' ? DOWNLOAD_LIMIT : (previewLimits[type] || 0) * 1024 ** 2;
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

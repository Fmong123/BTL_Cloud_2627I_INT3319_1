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
  const id = result.id ?? result.file_id;
  const key = result.key ?? result.s3_key;
  if (typeof id !== 'string' && typeof id !== 'number' && typeof key !== 'string') {
    throw new Error('API cần trả về id hoặc key của tệp đã lưu');
  }
  if (!id && !key) throw new Error('API chưa xác nhận tệp đã được lưu');
  if (result.storage != null && !['local', 's3'].includes(result.storage)) {
    throw new Error('API trả về loại lưu trữ chưa được hỗ trợ');
  }
  return {
    id,
    key,
    storage: result.storage ?? 'unspecified',
    scanStatus: result.scan_status ?? 'unknown',
  };
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
export function uploadFile(file, { baseUrl, signal, onProgress = () => {} }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Đã hủy tải lên', 'AbortError'));
    let endpoint;
    try {
      endpoint = `${validateApiBaseUrl(baseUrl)}/upload`;
    } catch (error) {
      reject(error);
      return;
    }
    const xhr = new XMLHttpRequest();
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
        const error = new Error(apiError(xhr));
        error.retryable = xhr.status >= 500 || [408, 429].includes(xhr.status);
        reject(error);
        return;
      }
      try {
        resolve(parseUploadResponse(xhr.responseText));
      } catch (error) {
        reject(error);
      }
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error('Không kết nối được backend — kiểm tra địa chỉ API, mạng và cấu hình CORS'));
    };
    xhr.ontimeout = () => {
      cleanup();
      reject(
        new Error('Backend phản hồi quá lâu — hãy kiểm tra tệp trên máy chủ trước khi thử lại'),
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

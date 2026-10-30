import '../file-workspace.css';

export default function LibraryWarnings({ items = [], onRefresh, loading = false }) {
  if (!items.length) return null;
  return (
    <div className="file-sync-message warning" role="status" aria-label="Tệp bị bỏ qua">
      <div className="file-sync-warning-details">
        <p>
          Đã bỏ qua {items.length} bản ghi tệp có metadata lỗi. Các tệp hợp lệ vẫn được tải; số
          lượng và dung lượng chỉ tính các tệp hiển thị.
        </p>
        <details>
          <summary>Xem chi tiết lỗi</summary>
          <ul>
            {items.slice(0, 10).map((item, index) => (
              <li key={index}>
                <strong>{item.name || item.id || `Bản ghi ${index + 1}`}</strong>
                {item.name && item.id ? ` (ID: ${item.id})` : ''}: {item.reason}
              </li>
            ))}
          </ul>
          {items.length > 10 && <p>Và {items.length - 10} bản ghi lỗi khác.</p>}
        </details>
      </div>
      <button className="text-button" disabled={loading} onClick={onRefresh}>
        Thử đồng bộ lại
      </button>
    </div>
  );
}

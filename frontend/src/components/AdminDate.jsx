export function reportDate(value) {
  return new Date(`${value}T00:00:00+07:00`).toLocaleDateString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
  });
}

export default function AdminDate({ value, inline = false }) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime()))
    return <span className="admin-muted">Chưa ghi nhận</span>;
  return (
    <time
      dateTime={date.toISOString()}
      className={`admin-date ${inline ? 'admin-date-inline' : ''}`}
    >
      <span className="cell-date">
        {date.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
      </span>
      {inline && <span aria-hidden="true"> · </span>}
      <span className="cell-time">
        {date.toLocaleTimeString('vi-VN', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Ho_Chi_Minh',
        })}
      </span>
    </time>
  );
}

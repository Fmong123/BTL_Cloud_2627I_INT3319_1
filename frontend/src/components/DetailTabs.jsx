const tabs = [
  ['information', 'Thông tin'],
  ['processing', 'Kết quả kiểm tra'],
  ['history', 'Lịch sử'],
];

export default function DetailTabs({ value, onChange, prefix }) {
  return (
    <div
      className="drawer-tabs"
      role="tablist"
      aria-label="Chi tiết tệp"
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = tabs.findIndex(([key]) => key === value);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        onChange(tabs[next][0]);
        document.getElementById(`${prefix}-${tabs[next][0]}-tab`)?.focus();
      }}
    >
      {tabs.map(([key, label]) => (
        <button
          key={key}
          id={`${prefix}-${key}-tab`}
          role="tab"
          aria-selected={value === key}
          tabIndex={value === key ? 0 : -1}
          aria-controls={`${prefix}-${key}`}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

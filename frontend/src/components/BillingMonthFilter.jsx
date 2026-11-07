import { useId } from 'react';

export default function BillingMonthFilter({ value, max, onChange }) {
  const labelId = useId();
  const [year, month] = value.split('-');
  const [currentYear, currentMonth] = max.split('-');
  const years = Array.from({ length: 10 }, (_, index) => String(Number(currentYear) - index));
  if (!years.includes(year)) years.push(year);
  return (
    <div className="billing-month-filter">
      <span id={labelId}>Kỳ chi phí</span>
      <div className="billing-month-parts" role="group" aria-labelledby={labelId}>
        <label>
          <span className="sr-only">Tháng chi phí</span>
          <select value={month} onChange={(event) => onChange(`${year}-${event.target.value}`)}>
            {Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0')).map(
              (number) => (
                <option
                  key={number}
                  value={number}
                  disabled={year === currentYear && number > currentMonth}
                >
                  {number}
                </option>
              ),
            )}
          </select>
        </label>
        <span aria-hidden="true">/</span>
        <label>
          <span className="sr-only">Năm chi phí</span>
          <select
            value={year}
            onChange={(event) => {
              const nextYear = event.target.value;
              onChange(
                `${nextYear}-${nextYear === currentYear && month > currentMonth ? currentMonth : month}`,
              );
            }}
          >
            {years.map((number) => (
              <option key={number} value={number}>
                {number}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

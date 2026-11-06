import { useEffect, useId, useRef, useState } from 'react';
import { Search, UserRound, X } from 'lucide-react';
import { getAdminAccountSuggestions } from '../api/client.js';

export default function AccountSearch({ baseUrl, value, onChange, onSelect }) {
  const id = useId();
  const root = useRef(null);
  const input = useRef(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [state, setState] = useState({ items: [], query: '' });
  const query = value.trim();
  const items = state.query === query ? state.items : [];
  useEffect(() => {
    if (!open || !query) return;
    const controller = new AbortController();
    setState({ items: [], loading: true, query });
    setActive(-1);
    const timer = setTimeout(() => {
      getAdminAccountSuggestions(baseUrl, query, { signal: controller.signal })
        .then((data) => {
          if (!controller.signal.aborted) setState({ items: data.items, query });
        })
        .catch((error) => {
          if (!controller.signal.aborted) setState({ items: [], query, error: error.message });
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [baseUrl, query, open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const visible = open && Boolean(query);
  function choose(item) {
    onSelect(item);
    input.current?.focus();
    setOpen(false);
    setActive(-1);
  }
  return (
    <div
      className="account-search"
      ref={root}
      onBlur={(event) => {
        if (!root.current?.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <label htmlFor={id}>Tìm tài khoản</label>
      <div className="account-search-control">
        <Search size={17} aria-hidden="true" />
        <input
          ref={input}
          id={id}
          type="search"
          role="combobox"
          autoComplete="off"
          maxLength={200}
          placeholder="Tên, email hoặc mã tài khoản…"
          value={value}
          aria-autocomplete="list"
          aria-expanded={visible}
          aria-controls={visible ? `${id}-suggestions` : undefined}
          aria-activedescendant={
            visible && active >= 0 && items[active] ? `${id}-option-${active}` : undefined
          }
          onFocus={() => setOpen(true)}
          onBlur={(event) => {
            if (!root.current?.contains(event.relatedTarget)) setOpen(false);
          }}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              setActive((index) =>
                items.length
                  ? index < 0
                    ? event.key === 'ArrowDown'
                      ? 0
                      : items.length - 1
                    : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
                  : -1,
              );
            } else if (event.key === 'Enter') {
              if (visible && items[active]) {
                event.preventDefault();
                choose(items[active]);
              } else setOpen(false);
            }
          }}
        />
        {value && (
          <button
            type="button"
            className="icon-button account-search-clear"
            aria-label="Xóa tìm tài khoản"
            onClick={() => {
              onChange('');
              setOpen(false);
              input.current?.focus();
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>
      {visible && (
        <div className="account-suggestions">
          <ul id={`${id}-suggestions`} role="listbox" aria-label="Tài khoản gợi ý">
            {items.map((item, index) => (
              <li key={item.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  id={`${id}-option-${index}`}
                  aria-selected={index === active}
                  tabIndex={-1}
                  onMouseDown={(event) => event.preventDefault()}
                  onPointerMove={() => setActive(index)}
                  onClick={() => choose(item)}
                >
                  <UserRound size={19} aria-hidden="true" />
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {item.email && item.email !== item.name ? item.email : item.username}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {(!items.length || state.query !== query) && (
            <p role="status">
              {state.query !== query || state.loading
                ? 'Đang tìm tài khoản…'
                : state.error || 'Không có người dùng phù hợp.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

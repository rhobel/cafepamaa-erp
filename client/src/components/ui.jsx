// Design system primitives (moodboard.html). Styles live in styles.css.
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { Icon } from './icons.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');

/** variant: default | primary (one per screen) | dark | danger */
export function Button({ variant = 'default', loading, disabled, className, children, ...props }) {
  return (
    <button
      type="button"
      className={cx('btn', variant !== 'default' && `btn-${variant}`, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Input({ label, error, hint, className, ...props }) {
  const id = useId();
  return (
    <div className={cx('field', className)}>
      {label && (
        <label className="lbl" htmlFor={id}>
          {label}
        </label>
      )}
      <input
        id={id}
        className={cx('input', error && 'input-error')}
        aria-invalid={!!error || undefined}
        aria-describedby={error || hint ? `${id}-msg` : undefined}
        {...props}
      />
      {(error || hint) && (
        <div id={`${id}-msg`} className={error ? 'field-error' : 'field-hint'}>
          {error || hint}
        </div>
      )}
    </div>
  );
}

export function Select({ label, error, className, children, ...props }) {
  const id = useId();
  return (
    <div className={cx('field', className)}>
      {label && (
        <label className="lbl" htmlFor={id}>
          {label}
        </label>
      )}
      <select id={id} className={cx('input', error && 'input-error')} {...props}>
        {children}
      </select>
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}

export function Textarea({ label, error, className, ...props }) {
  const id = useId();
  return (
    <div className={cx('field', className)}>
      {label && (
        <label className="lbl" htmlFor={id}>
          {label}
        </label>
      )}
      <textarea id={id} className={cx('input textarea', error && 'input-error')} {...props} />
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}

/** tone: ok (Available) | busy (Occupied) | bill (Billing) | gray. Always pair colour with a label. */
export function Badge({ tone = 'gray', dot = tone !== 'gray', children }) {
  return (
    <span className={`badge b-${tone}`}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

export function Toggle({ label, ...props }) {
  return (
    <label className="toggle">
      {label}
      <input type="checkbox" role="switch" className="switch" {...props} />
    </label>
  );
}

export function Checkbox({ label, ...props }) {
  return (
    <label className="check">
      <input type="checkbox" {...props} />
      {label}
    </label>
  );
}

/** Native <dialog>: focus trap and Esc-to-close for free. */
export function Modal({ open, onClose, title, children, footer }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="modal" onClose={onClose} aria-labelledby="modal-title">
      <div className="modal-head">
        <h2 id="modal-title">{title}</h2>
        <button type="button" className="btn icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-foot">{footer}</div>}
    </dialog>
  );
}

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const toast = useCallback((message, tone = 'ok') => {
    const id = crypto.randomUUID();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** const toast = useToast(); toast('Saved'); toast('Failed', 'error') */
export const useToast = () => useContext(ToastContext);

/**
 * columns: [{ key, label, num?, render?(row) }]
 * Handles loading, empty and row-click states.
 */
export function Table({
  columns,
  rows,
  rowKey = '_id',
  onRowClick,
  loading,
  empty = 'Nothing here yet',
}) {
  return (
    <div className="tbl-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.num ? 'num' : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            [0, 1, 2].map((i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key}>
                    <span className="skeleton" />
                  </td>
                ))}
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="empty">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row[rowKey]}
                onClick={onRowClick && (() => onRowClick(row))}
                className={onRowClick ? 'clickable' : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={c.num ? 'num' : undefined}>
                    {c.render ? c.render(row) : row[c.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Wrap several in <div className="stats">. */
export function StatCard({ label, value, sub }) {
  return (
    <div className="stat">
      <div className="t">{label}</div>
      <div className="v">{value}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  );
}

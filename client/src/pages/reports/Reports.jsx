import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatINR } from '../../money.js';
import { Button, Input, Select, Table } from '../../components/ui.jsx';
import { formatDate } from '../customers/Customers.jsx';
import { METHODS } from '../invoices/InvoiceHistory.jsx';
import './Reports.css';

const money = (key, label) => ({ key, label, num: true, money: true });
const date = { key: 'date', label: 'Date', text: (r) => formatDate(r.date) };

// Columns per report type (API contract: rows + totals, money in paise).
const TYPES = {
  sales: {
    label: 'Sales summary',
    columns: [
      date,
      { key: 'bills', label: 'Bills', num: true },
      money('subtotal', 'Subtotal'),
      money('discount', 'Discount'),
      money('taxable', 'Taxable'),
      money('cgst', 'CGST'),
      money('sgst', 'SGST'),
      money('roundOff', 'Round off'),
      money('grandTotal', 'Grand total'),
    ],
  },
  payments: {
    label: 'Payment methods',
    columns: [
      { key: 'method', label: 'Method', text: (r) => String(r.method ?? '').toUpperCase() },
      { key: 'count', label: 'Payments', num: true },
      money('amount', 'Amount'),
    ],
  },
  items: {
    label: 'Item-wise',
    columns: [
      { key: 'name', label: 'Item' },
      { key: 'qty', label: 'Qty', num: true },
      money('amount', 'Amount'),
    ],
  },
  categories: {
    label: 'Category-wise',
    columns: [
      { key: 'category', label: 'Category' },
      { key: 'qty', label: 'Qty', num: true },
      money('amount', 'Amount'),
    ],
  },
  discounts: {
    label: 'Discounts',
    columns: [
      { key: 'invoiceNumber', label: 'Invoice' },
      date,
      { key: 'cashierName', label: 'Cashier' },
      {
        key: 'value',
        label: 'Discount',
        text: (r) =>
          r.type === 'percent'
            ? `${r.value}%`
            : r.type === 'flat'
              ? `Flat ${(r.value / 100).toFixed(2)}`
              : '',
      },
      money('amount', 'Amount'),
    ],
  },
  gst: {
    label: 'GST summary',
    columns: [
      date,
      money('taxable', 'Taxable'),
      money('cgst', 'CGST'),
      money('sgst', 'SGST'),
      money('tax', 'Total tax'),
    ],
  },
};

const TOTAL = Symbol('total');

/** Cell text. csv=true → money as plain rupees ("1234.50") instead of "₹1,234.50". */
function cellText(col, row, csv) {
  if (row[TOTAL] && col === row[TOTAL]) return row.label;
  const v = row[col.key];
  if (v === undefined || v === null) return '';
  if (col.money) return csv ? (v / 100).toFixed(2) : formatINR(v);
  if (row[TOTAL]) return String(v);
  return col.text ? col.text(row) : String(v);
}

const csvCell = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** RFC 4180 CSV with a UTF-8 BOM so Excel shows ₹ and Indic names correctly. */
export const toCsv = (lines) => '\uFEFF' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n');

export function csvSelfCheck() {
  const eq = (a, b) => {
    if (a !== b) throw new Error(`csvSelfCheck: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
  };
  eq(toCsv([['a', 'b']]), '\uFEFFa,b');
  eq(toCsv([['x,y']]), '\uFEFF"x,y"');
  eq(toCsv([['say "hi"']]), '\uFEFF"say ""hi"""');
  eq(toCsv([['two\nlines'], ['']]), '\uFEFF"two\nlines"\r\n');
  eq(cellText(money('a', 'A'), { a: 123450 }, true), '1234.50');
  eq(cellText(money('a', 'A'), { a: -40 }, true), '-0.40');
  return true;
}

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export function ReportsPage() {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const today = todayIST();
  const [f, setF] = useState({
    type: 'sales',
    from: today,
    to: today,
    cashier: '',
    method: '',
    category: '',
  });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const def = TYPES[f.type];
  const showCategory = f.type === 'items' || f.type === 'categories';

  // Cashier: server pins to today + own shift; we send today for clarity.
  const from = isAdmin ? f.from : today;
  const to = isAdmin ? f.to : today;
  const ready = Boolean(from && to);
  const qs = new URLSearchParams({ from, to });
  if (isAdmin && f.cashier) qs.set('cashier', f.cashier);
  if (f.method) qs.set('method', f.method);
  if (showCategory && f.category) qs.set('category', f.category);

  const query = useQuery({
    queryKey: ['reports', f.type, qs.toString()],
    queryFn: () => api(`/reports/${f.type}?${qs}`),
    enabled: ready,
    placeholderData: keepPreviousData,
  });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api('/users'), enabled: isAdmin });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api('/categories') });

  // Placeholder data may belong to the previous type; only render a matching result.
  const data = query.data?.type === f.type ? query.data : null;
  const rows = (data?.rows ?? []).map((r, i) => ({ ...r, _k: i }));
  if (rows.length && data.totals) {
    const label = f.type === 'discounts' ? `Total (${data.totals.count ?? rows.length})` : 'Total';
    rows.push({ ...data.totals, _k: 'total', [TOTAL]: def.columns[0], label });
  }
  const columns = def.columns.map((c) => ({ ...c, render: (r) => cellText(c, r, false) }));
  const range = from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;

  const exportCsv = () => {
    const csv = toCsv([
      def.columns.map((c) => c.label),
      ...rows.map((r) => def.columns.map((c) => cellText(c, r, true))),
    ]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `report-${f.type}-${from}-${to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 0);
  };

  return (
    <div className="stack rep-page">
      <h2 className="rep-print-title">
        {def.label} · {range}
      </h2>

      <div className="stack rep-filters">
        <div className="seg" role="group" aria-label="Report type">
          {Object.entries(TYPES).map(([k, t]) => (
            <button
              key={k}
              type="button"
              className="btn"
              aria-pressed={f.type === k}
              onClick={() => setF((s) => ({ ...s, type: k }))}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="panel pad rep-grid">
          {isAdmin ? (
            <>
              <Input label="From" type="date" value={f.from} max={f.to} onChange={set('from')} />
              <Input label="To" type="date" value={f.to} min={f.from} onChange={set('to')} />
              <Select label="Cashier" value={f.cashier} onChange={set('cashier')}>
                <option value="">All staff</option>
                {(users.data ?? []).map((u) => (
                  <option key={u._id} value={u._id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </>
          ) : (
            <div className="field">
              <span className="lbl">Period</span>
              <b className="rep-period">Today · your shift</b>
            </div>
          )}
          <Select label="Payment method" value={f.method} onChange={set('method')}>
            <option value="">All methods</option>
            {METHODS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          {showCategory && (
            <Select label="Category" value={f.category} onChange={set('category')}>
              <option value="">All categories</option>
              {(categories.data ?? []).map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
          <div className="rep-actions">
            <Button onClick={exportCsv} disabled={!rows.length}>
              Export CSV
            </Button>
            <Button onClick={() => window.print()} disabled={!rows.length}>
              Print
            </Button>
          </div>
        </div>
      </div>

      {query.isError ? (
        <div className="panel pad">
          <p>Could not load report: {query.error.message}</p>
          {query.error.status >= 500 && <Button onClick={() => query.refetch()}>Retry</Button>}
        </div>
      ) : (
        <div className="rep-table">
          <Table
            columns={columns}
            rows={rows}
            rowKey="_k"
            loading={ready && (query.isPending || (!data && query.isFetching))}
            empty={ready ? 'No data for this period' : 'Pick a date range'}
          />
        </div>
      )}
    </div>
  );
}

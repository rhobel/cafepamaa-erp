import { useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatINR } from '../../money.js';
import { Button, Input, Select, Table } from '../../components/ui.jsx';
import { formatDate } from '../customers/Customers.jsx';
import { formatTime } from '../bills/RunningBills.jsx';
import './InvoiceHistory.css';

const LIMIT = 50;
const FILTERS = ['from', 'to', 'q', 'table', 'method', 'cashier'];
export const METHODS = [
  ['cash', 'Cash'],
  ['upi', 'UPI'],
  ['card', 'Card'],
];

/** Columns for the invoice summary shape (shared with the dashboard). */
export const INVOICE_COLUMNS = [
  {
    key: 'invoiceNumber',
    label: 'Invoice',
    render: (i) => <span className="mono">{i.invoiceNumber}</span>,
  },
  {
    key: 'createdAt',
    label: 'Date / time',
    render: (i) => `${formatDate(i.createdAt)}, ${formatTime(i.createdAt)}`,
  },
  { key: 'billNumber', label: 'Bill', render: (i) => <span className="mono">{i.billNumber}</span> },
  { key: 'tableNumber', label: 'Table' },
  {
    key: 'customer',
    label: 'Customer',
    render: (i) => (
      <div className="ih-customer">
        <b>{i.customer?.name || 'Walk-in'}</b>
        <span className="muted">{i.customer?.mobile}</span>
      </div>
    ),
  },
  { key: 'grandTotal', label: 'Total', num: true, render: (i) => formatINR(i.grandTotal) },
  {
    key: 'payments',
    label: 'Paid by',
    render: (i) => [...new Set((i.payments ?? []).map((p) => p.method.toUpperCase()))].join(' + '),
  },
  { key: 'cashierName', label: 'Cashier' },
];

export function InvoiceHistoryPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);

  const qs = new URLSearchParams({ page, limit: LIMIT });
  for (const k of FILTERS) if (params.get(k)) qs.set(k, params.get(k));

  const query = useQuery({
    queryKey: ['invoices', 'history', qs.toString()],
    queryFn: () => api(`/invoices?${qs}`),
    placeholderData: keepPreviousData,
  });
  // GET /users is admin-only.
  const users = useQuery({ queryKey: ['users'], queryFn: () => api('/users'), enabled: isAdmin });

  const apply = (e) => {
    e.preventDefault();
    const next = new URLSearchParams();
    for (const [k, v] of new FormData(e.currentTarget)) if (String(v).trim()) next.set(k, v.trim());
    setParams(next);
  };
  const goto = (p) => {
    const next = new URLSearchParams(params);
    next.set('page', p);
    setParams(next);
  };
  const submitNow = (e) => e.target.form.requestSubmit();
  const rows = query.data ?? [];
  const filtered = FILTERS.some((k) => params.get(k));

  return (
    <div className="stack">
      {/* Uncontrolled form, remounted when the URL changes so back/refresh restores it. */}
      <form key={params.toString()} className="ih-filters panel pad" onSubmit={apply}>
        <Input
          label="From"
          type="date"
          name="from"
          defaultValue={params.get('from') ?? ''}
          onChange={submitNow}
        />
        <Input
          label="To"
          type="date"
          name="to"
          defaultValue={params.get('to') ?? ''}
          onChange={submitNow}
        />
        <Input
          label="Invoice no. / mobile"
          type="search"
          name="q"
          placeholder="INV/… or 98…"
          defaultValue={params.get('q') ?? ''}
        />
        <Input
          label="Table"
          name="table"
          placeholder="T5"
          defaultValue={params.get('table') ?? ''}
        />
        <Select
          label="Payment"
          name="method"
          defaultValue={params.get('method') ?? ''}
          onChange={submitNow}
        >
          <option value="">All methods</option>
          {METHODS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        {isAdmin && (
          <Select
            label="Cashier"
            name="cashier"
            defaultValue={params.get('cashier') ?? ''}
            onChange={submitNow}
          >
            <option value="">All staff</option>
            {(users.data ?? []).map((u) => (
              <option key={u._id} value={u._id}>
                {u.name}
              </option>
            ))}
          </Select>
        )}
        <div className="ih-actions">
          <Button type="submit" variant="primary">
            Search
          </Button>
          {filtered && <Button onClick={() => setParams({})}>Clear</Button>}
        </div>
      </form>

      {query.isError ? (
        <div className="panel pad">
          <p>Could not load invoices: {query.error.message}</p>
          <Button onClick={() => query.refetch()}>Retry</Button>
        </div>
      ) : (
        <Table
          columns={INVOICE_COLUMNS}
          rows={rows}
          loading={query.isPending}
          onRowClick={(i) => navigate(`/invoices/${i._id}`)}
          empty={filtered ? 'No invoices match these filters' : 'No invoices yet'}
        />
      )}

      <div className="row ih-pager">
        <span className="muted">
          Page {page}
          {query.isFetching && !query.isPending && ' · Loading…'}
        </span>
        <Button disabled={page <= 1} onClick={() => goto(page - 1)}>
          Prev
        </Button>
        <Button
          disabled={rows.length < LIMIT || query.isPlaceholderData}
          onClick={() => goto(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

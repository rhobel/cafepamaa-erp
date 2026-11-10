import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { formatINR } from '../../money.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Button, StatCard, Table } from '../../components/ui.jsx';
import { STATUS } from '../bills/RunningBills.jsx';
import { formatDate } from './Customers.jsx';

const formatDateTime = (d) =>
  new Date(d).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const METHOD = { cash: 'Cash', upi: 'UPI', card: 'Card' };
const methods = (payments = []) =>
  [...new Set(payments.map((p) => METHOD[p.method] ?? p.method))].join(' + ') || '—';

const columns = [
  {
    key: 'invoiceNumber',
    label: 'Invoice no.',
    render: (i) => <span className="mono">{i.invoiceNumber}</span>,
  },
  { key: 'createdAt', label: 'Date & time', render: (i) => formatDateTime(i.createdAt) },
  { key: 'tableNumber', label: 'Table', render: (i) => i.tableNumber || '—' },
  { key: 'payments', label: 'Payment', render: (i) => methods(i.payments) },
  { key: 'grandTotal', label: 'Amount', num: true, render: (i) => formatINR(i.grandTotal) },
];

export function CustomerProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canOpenBilling = user?.role === 'admin' || user?.role === 'cashier';

  const query = useQuery({
    queryKey: ['customers', id, 'history'],
    queryFn: () => api(`/customers/${id}/history`),
  });

  const back = (
    <div>
      <Link className="btn" to="/customers">
        ← Customers
      </Link>
    </div>
  );

  if (query.isPending) return <div className="panel pad muted">Loading customer…</div>;
  if (query.isError)
    return query.error.status === 404 ? (
      <div className="center-msg">
        <h1>Customer not found</h1>
        <p>It may have been removed or the link is wrong.</p>
        <Link className="btn" to="/customers">
          Back to customers
        </Link>
      </div>
    ) : (
      <div className="stack">
        {back}
        <div className="panel pad">
          <p>Could not load customer: {query.error.message}</p>
          <Button onClick={() => query.refetch()}>Retry</Button>
        </div>
      </div>
    );

  const { customer: c, activeBill: ab, invoices } = query.data;
  const notice = ab && (
    <>
      Open bill <span className="mono">{ab.billNumber}</span> · Table {ab.tableNumber} ·{' '}
      {formatINR(ab.subtotal)} · {STATUS[ab.status]?.label ?? ab.status}
    </>
  );

  return (
    <div className="stack">
      {back}

      <div className="panel pad">
        <h2>{c.name || 'Walk-in customer'}</h2>
        <div className="muted">
          <span className="mono">{c.mobile}</span> · Customer since {formatDate(c.createdAt)}
        </div>
      </div>

      <div className="stats">
        <StatCard label="Visits" value={c.totalVisits} />
        <StatCard label="Total spent" value={formatINR(c.totalSpent)} />
        <StatCard
          label="Average bill"
          value={c.totalVisits ? formatINR(Math.round(c.totalSpent / c.totalVisits)) : '—'}
        />
        <StatCard label="Last visit" value={formatDate(c.lastVisitAt)} />
      </div>

      {ab && (
        <div className="panel pad" role="status">
          {canOpenBilling ? <Link to={`/bills/${ab._id}`}>{notice}</Link> : notice}
        </div>
      )}

      <h2>Invoice history</h2>
      <Table
        columns={columns}
        rows={invoices}
        onRowClick={canOpenBilling ? (i) => navigate(`/invoices/${i._id}`) : undefined}
        empty="No invoices yet"
      />
    </div>
  );
}

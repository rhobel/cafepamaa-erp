import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { formatINR } from '../../money.js';
import { Badge, Button, StatCard, Table } from '../../components/ui.jsx';
import './RunningBills.css';

export const formatTime = (d) =>
  new Date(d).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
  });

export const STATUS = {
  open: { tone: 'busy', label: 'Open' },
  billing: { tone: 'bill', label: 'Billing' },
  paid: { tone: 'ok', label: 'Paid' },
  cancelled: { tone: 'gray', label: 'Cancelled' },
};
export const StatusBadge = ({ status }) => {
  const s = STATUS[status] ?? { tone: 'gray', label: status };
  return <Badge tone={s.tone}>{s.label}</Badge>;
};

const FILTERS = [
  ['', 'All'],
  ['open', 'Open'],
  ['billing', 'Billing'],
];

const matches = (b, q) =>
  !q ||
  [b.billNumber, b.tableNumber, b.customerMobile, b.customerName].some((v) =>
    String(v ?? '')
      .toLowerCase()
      .includes(q),
  );

export function RunningBillsPage() {
  const navigate = useNavigate();
  const searchRef = useRef(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');

  const query = useQuery({
    queryKey: ['bills'],
    queryFn: () => api('/bills'),
    refetchInterval: 10000,
  });

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const bills = query.data ?? [];
  const needle = q.trim().toLowerCase();
  const rows = bills.filter((b) => (!status || b.status === status) && matches(b, needle));

  const columns = [
    {
      key: 'billNumber',
      label: 'Bill',
      render: (b) => <span className="mono">{b.billNumber}</span>,
    },
    { key: 'tableNumber', label: 'Table', render: (b) => b.tableNumber },
    {
      key: 'customer',
      label: 'Customer',
      render: (b) => (
        <div className="rb-customer">
          <b>{b.customerName || 'Walk-in'}</b>
          <span className="muted">{b.customerMobile}</span>
        </div>
      ),
    },
    { key: 'roundCount', label: 'Rounds', num: true },
    { key: 'status', label: 'Status', render: (b) => <StatusBadge status={b.status} /> },
    { key: 'openedAt', label: 'Opened', render: (b) => formatTime(b.openedAt) },
    { key: 'subtotal', label: 'Total', num: true, render: (b) => formatINR(b.subtotal) },
  ];

  return (
    <div>
      <div className="stats rb-stats">
        <StatCard label="Open bills" value={bills.filter((b) => b.status === 'open').length} />
        <StatCard label="At checkout" value={bills.filter((b) => b.status === 'billing').length} />
        <StatCard
          label="Running value"
          value={formatINR(bills.reduce((s, b) => s + b.subtotal, 0))}
        />
      </div>

      <div className="toolbar">
        <input
          ref={searchRef}
          className="input"
          type="search"
          placeholder="Search mobile / table / bill no."
          aria-label="Search running bills"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="seg" role="group" aria-label="Filter by status">
          {FILTERS.map(([v, l]) => (
            <button
              key={v}
              type="button"
              className="btn"
              aria-pressed={status === v}
              onClick={() => setStatus(v)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {query.isError ? (
        <div className="panel pad">
          <p>Could not load running bills: {query.error.message}</p>
          <Button onClick={() => query.refetch()}>Retry</Button>
        </div>
      ) : (
        <Table
          columns={columns}
          rows={rows}
          loading={query.isPending}
          onRowClick={(b) => navigate(`/bills/${b._id}`)}
          empty={bills.length ? 'No bills match your search' : 'No running bills right now'}
        />
      )}
    </div>
  );
}

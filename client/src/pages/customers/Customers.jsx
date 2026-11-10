import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { formatINR } from '../../money.js';
import { Button, Table } from '../../components/ui.jsx';

/** → "02 Nov 2026" (IST), "—" when missing */
export const formatDate = (d) =>
  d
    ? new Date(d).toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '—';

const columns = [
  { key: 'name', label: 'Name', render: (c) => c.name || '—' },
  { key: 'mobile', label: 'Mobile', render: (c) => <span className="mono">{c.mobile}</span> },
  { key: 'totalVisits', label: 'Visits', num: true },
  { key: 'totalSpent', label: 'Total spent', num: true, render: (c) => formatINR(c.totalSpent) },
  { key: 'lastVisitAt', label: 'Last visit', render: (c) => formatDate(c.lastVisitAt) },
];

export function CustomersPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const query = useQuery({
    queryKey: ['customers', 'search', debounced],
    queryFn: () => api(`/customers/search?q=${encodeURIComponent(debounced)}`),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="stack">
      <div className="toolbar">
        <input
          className="input"
          type="search"
          placeholder="Search by mobile or name"
          aria-label="Search customers"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {query.isFetching && !query.isPending && <span className="muted">Searching…</span>}
      </div>

      {query.isError ? (
        <div className="panel pad">
          <p>Could not load customers: {query.error.message}</p>
          <Button onClick={() => query.refetch()}>Retry</Button>
        </div>
      ) : (
        <Table
          columns={columns}
          rows={query.data ?? []}
          loading={query.isPending}
          onRowClick={(c) => navigate(`/customers/${c._id}`)}
          empty={debounced ? `No customers match “${debounced}”` : 'No customers yet'}
        />
      )}
    </div>
  );
}

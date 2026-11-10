import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatINR } from '../../money.js';
import { Button, StatCard, Table } from '../../components/ui.jsx';
import { LiveTables } from '../Tables.jsx';
import { INVOICE_COLUMNS, METHODS } from '../invoices/InvoiceHistory.jsx';
import './Dashboard.css';

function PaymentSplit({ split = {} }) {
  const total = METHODS.reduce((s, [m]) => s + (split[m] ?? 0), 0);
  return (
    <div className="dash-split">
      {METHODS.map(([m, label]) => {
        const amt = split[m] ?? 0;
        const pct = total ? Math.round((amt / total) * 100) : 0;
        return (
          <div key={m} className="dash-split-row">
            <div className="row dash-split-head">
              <b>{label}</b>
              <span className="muted">
                {formatINR(amt)} · {pct}%
              </span>
            </div>
            <div
              className="dash-bar"
              role="meter"
              aria-label={label}
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <i className={`dash-bar-${m}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
      {!total && <p className="muted">No payments yet today.</p>}
    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api('/dashboard/summary'),
    refetchInterval: 30000,
  });
  const d = query.data;
  const t = d?.tables;
  const dash = '…';

  if (query.isError) {
    return (
      <div className="panel pad">
        <p>Could not load the dashboard: {query.error.message}</p>
        <Button onClick={() => query.refetch()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="stack">
      <p className="muted dash-scope">
        {user.role === 'cashier' ? 'Your shift today' : 'Today'}
        {d?.date && ` · ${d.date}`}
      </p>
      <div className="stats" aria-busy={query.isPending}>
        <StatCard label="Today Sales" value={d ? formatINR(d.sales) : dash} />
        <StatCard label="Bills Today" value={d ? d.billCount : dash} />
        <StatCard
          label="Open Bills"
          value={d ? `${d.openBills.count} · ${formatINR(d.openBills.value)}` : dash}
        />
        <StatCard
          label="Tables"
          value={t ? `${t.occupied + t.billing}/${t.total} used` : dash}
          sub={t && `${t.available} available`}
        />
      </div>

      <div className="dash-grid">
        <section className="panel pad">
          <h2 className="dash-h">Payment split</h2>
          {d ? <PaymentSplit split={d.paymentSplit} /> : <span className="skeleton" />}
        </section>
        <section className="panel pad">
          <h2 className="dash-h">Table status</h2>
          <LiveTables />
        </section>
      </div>

      <section className="stack">
        <h2 className="dash-h">Recent invoices</h2>
        <Table
          columns={INVOICE_COLUMNS}
          rows={d?.recentInvoices ?? []}
          loading={query.isPending}
          onRowClick={(i) => navigate(`/invoices/${i._id}`)}
          empty="No invoices yet today"
        />
      </section>
    </div>
  );
}

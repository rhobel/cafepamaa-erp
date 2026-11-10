import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { formatINR } from '../../money.js';
import { Badge, Button, Table } from '../../components/ui.jsx';
import './Pos.css';

/** IST date + time, e.g. "11 Nov, 8:41 pm" */
export const formatTime = (d) =>
  d
    ? new Date(d).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';

export function Loading() {
  return (
    <div className="panel pad stack" aria-busy="true">
      <span className="skeleton" />
      <span className="skeleton" />
    </div>
  );
}

export function LoadError({ query }) {
  return (
    <div className="center-msg stack">
      <p>{query.error.message}</p>
      <div>
        <Button onClick={() => query.refetch()}>Retry</Button>
      </div>
    </div>
  );
}

/** Read-only rounds of a bill (also used as "Previous rounds" in the POS cart). */
export function Rounds({ rounds }) {
  if (!rounds.length) return <p className="muted">No rounds yet.</p>;
  return (
    <div className="stack">
      {rounds.map((r) => (
        <section key={r.orderNumber} className="pos-round">
          <div className="pos-line-top">
            <b>{r.orderNumber}</b>
            <span className="muted">
              {r.waiterName} · {formatTime(r.createdAt)}
            </span>
          </div>
          <ul className="pos-lines">
            {r.items.map((it, i) => (
              <li key={i} className={it.isVoided ? 'voided' : undefined}>
                <div className="pos-line-top">
                  <span>
                    {it.name} × {it.qty} {it.isVoided && <Badge>Voided</Badge>}
                  </span>
                  <span className="num">{formatINR(it.lineTotal)}</span>
                </div>
                {it.addOns.map((a, j) => (
                  <div key={j} className="muted">
                    + {a.name} {formatINR(a.price)}
                  </div>
                ))}
                {it.instructions && <div className="muted">“{it.instructions}”</div>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function MyOrdersPage() {
  const [params] = useSearchParams();
  const id = params.get('id');
  return id ? <OrderDetail key={id} id={id} /> : <OrderList />;
}

function OrderList() {
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ['bills', 'mine'],
    queryFn: () => api('/bills?mine=true'),
    refetchInterval: 10000,
  });

  if (q.isError) return <LoadError query={q} />;

  const columns = [
    { key: 'tableNumber', label: 'Table', render: (r) => <b>{r.tableNumber}</b> },
    {
      key: 'customer',
      label: 'Customer',
      render: (r) => (
        <div>
          {r.customerName || 'Guest'}
          <div className="muted mono">{r.customerMobile}</div>
        </div>
      ),
    },
    { key: 'roundCount', label: 'Rounds', num: true },
    { key: 'subtotal', label: 'Running total', num: true, render: (r) => formatINR(r.subtotal) },
    {
      key: 'status',
      label: 'Status',
      render: (r) =>
        r.status === 'billing' ? <Badge tone="bill">At checkout</Badge> : <Badge>Open</Badge>,
    },
    { key: 'openedAt', label: 'Opened', render: (r) => formatTime(r.openedAt) },
  ];

  return (
    <Table
      columns={columns}
      rows={q.data ?? []}
      loading={q.isPending}
      onRowClick={(r) => navigate(`/my-orders?id=${r._id}`)}
      empty="No open bills. Start one from New Order."
    />
  );
}

function OrderDetail({ id }) {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['bill', id], queryFn: () => api(`/bills/${id}`) });

  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError query={q} />;
  const b = q.data;

  return (
    <div className="stack">
      <div className="pos-head">
        <div>
          <b>
            {b.billNumber} · Table {b.tableNumber} · {b.customerName || 'Guest'}
          </b>
          <div className="muted">
            Opened {formatTime(b.openedAt)} · Running total {formatINR(b.subtotal)}
          </div>
        </div>
        <span className="grow" />
        <Button onClick={() => navigate('/my-orders')}>Back</Button>
        {b.status === 'open' ? (
          <Button variant="primary" onClick={() => navigate(`/pos?bill=${b._id}`)}>
            Add more items
          </Button>
        ) : (
          <Badge tone="bill">{b.status === 'billing' ? 'At checkout' : 'Closed'}</Badge>
        )}
      </div>
      <div className="panel pad">
        <Rounds rounds={b.rounds} />
      </div>
    </div>
  );
}

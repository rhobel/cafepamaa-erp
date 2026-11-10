import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatINR } from '../../money.js';
import { Button, Modal, Textarea, useToast } from '../../components/ui.jsx';
import { formatTime, StatusBadge } from './RunningBills.jsx';
import './BillDetail.css';

export function BillDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const isAdmin = useAuth().user?.role === 'admin';
  const [voiding, setVoiding] = useState(null); // item
  const [cancelling, setCancelling] = useState(false);

  const query = useQuery({
    queryKey: ['bill', id],
    queryFn: () => api(`/bills/${id}`),
    refetchInterval: 10000,
    retry: (n, e) => e.status !== 404 && n < 2,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['bills'] });
    qc.invalidateQueries({ queryKey: ['bill', id] });
  };

  const checkout = useMutation({
    mutationFn: () => api(`/bills/${id}/checkout`, { method: 'POST' }),
    onSuccess: () => {
      refresh();
      navigate(`/billing/${id}`);
    },
    onError: (e) => toast(e.message, 'error'),
  });

  const voidItem = useMutation({
    mutationFn: ({ itemId, reason }) =>
      api(`/bills/${id}/items/${itemId}/void`, { method: 'PATCH', body: { reason } }),
    onSuccess: () => {
      refresh();
      setVoiding(null);
      toast('Item voided');
    },
  });

  const cancel = useMutation({
    mutationFn: (reason) => api(`/bills/${id}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: (bill) => {
      refresh();
      toast(`Bill ${bill?.billNumber ?? ''} cancelled`);
      navigate('/bills');
    },
  });

  if (query.isPending) return <div className="panel pad muted">Loading bill…</div>;
  if (query.isError)
    return query.error.status === 404 ? (
      <div className="center-msg">
        <h1>Bill not found</h1>
        <p>It may have been removed or the link is wrong.</p>
        <Link className="btn" to="/bills">
          Back to running bills
        </Link>
      </div>
    ) : (
      <div className="panel pad">
        <p>Could not load bill: {query.error.message}</p>
        <Button onClick={() => query.refetch()}>Retry</Button>
      </div>
    );

  const bill = query.data;
  const active = bill.status === 'open' || bill.status === 'billing';
  const waiters = [...new Set(bill.rounds.map((r) => r.waiterName).filter(Boolean))];
  const hasLiveItems = bill.rounds.some((r) => r.items.some((i) => !i.isVoided));

  return (
    <div className="stack">
      <div>
        <Link className="btn" to="/bills">
          ← Running bills
        </Link>
      </div>

      <div className="panel pad">
        <div className="bd-head">
          <div>
            <h2>
              <span className="mono">{bill.billNumber}</span>
              <StatusBadge status={bill.status} />
            </h2>
          </div>
          <div className="actions">
            {isAdmin && active && !hasLiveItems && (
              <Button variant="danger" onClick={() => setCancelling(true)}>
                Cancel bill
              </Button>
            )}
            {bill.status === 'open' && (
              <Button variant="dark" loading={checkout.isPending} onClick={() => checkout.mutate()}>
                Proceed to Checkout
              </Button>
            )}
            {bill.status === 'billing' && (
              <Link className="btn btn-primary" to={`/billing/${id}`}>
                Continue checkout
              </Link>
            )}
          </div>
        </div>
        <dl className="bd-meta">
          <div>
            <dt>Table</dt>
            <dd>{bill.tableNumber}</dd>
          </div>
          <div>
            <dt>Customer</dt>
            <dd>
              {bill.customerName || 'Walk-in'} <span className="muted">{bill.customerMobile}</span>
            </dd>
          </div>
          <div>
            <dt>Waiter{waiters.length > 1 && 's'}</dt>
            <dd>{waiters.join(', ') || '—'}</dd>
          </div>
          <div>
            <dt>Opened</dt>
            <dd>{formatTime(bill.openedAt)}</dd>
          </div>
        </dl>
        {!active && (
          <p className="muted">This bill is {bill.status} and can no longer be changed.</p>
        )}
      </div>

      {bill.rounds.map((r, n) => (
        <div key={r.orderNumber} className="panel pad bd-round">
          <h3>
            Round {n + 1} · <span className="mono">{r.orderNumber}</span> ·{' '}
            {formatTime(r.createdAt)}
            {r.waiterName && ` · by ${r.waiterName}`}
          </h3>
          {r.items.map((i) => (
            <div key={i._id} className={i.isVoided ? 'bd-item voided' : 'bd-item'}>
              <div className="info">
                <div className="name">{i.name}</div>
                {i.addOns?.length > 0 && (
                  <div className="sub muted">
                    + {i.addOns.map((a) => `${a.name} (${formatINR(a.price)})`).join(', ')}
                  </div>
                )}
                {i.instructions && (
                  <div className="sub muted">
                    <i>{i.instructions}</i>
                  </div>
                )}
                {i.isVoided && <div className="bd-void-reason">Voided: {i.voidReason}</div>}
              </div>
              <div className="amt">
                <div className="sub muted">
                  {i.qty} × {formatINR(i.price + (i.addOns ?? []).reduce((s, a) => s + a.price, 0))}
                </div>
                <div>{formatINR(i.lineTotal)}</div>
              </div>
              {isAdmin && active && !i.isVoided && (
                <Button variant="danger" onClick={() => setVoiding(i)}>
                  Void
                </Button>
              )}
            </div>
          ))}
        </div>
      ))}

      <div className="panel pad bd-total">
        <span>Subtotal</span>
        <span>{formatINR(bill.subtotal)}</span>
      </div>

      {voiding && (
        <ReasonModal
          title={`Void ${voiding.qty} × ${voiding.name}?`}
          text="The item stays on the bill, struck through, and is removed from the total."
          confirm="Void item"
          mutation={voidItem}
          onSubmit={(reason) => voidItem.mutate({ itemId: voiding._id, reason })}
          onClose={() => {
            setVoiding(null);
            voidItem.reset();
          }}
        />
      )}
      {cancelling && (
        <ReasonModal
          title={`Cancel bill ${bill.billNumber}?`}
          text={`The bill will be closed and Table ${bill.tableNumber} released.`}
          confirm="Cancel bill"
          mutation={cancel}
          onSubmit={(reason) => cancel.mutate(reason)}
          onClose={() => {
            setCancelling(false);
            cancel.reset();
          }}
        />
      )}
    </div>
  );
}

function ReasonModal({ title, text, confirm, mutation, onSubmit, onClose }) {
  const [reason, setReason] = useState('');
  const trimmed = reason.trim();
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <div className="actions">
          <Button onClick={onClose}>Keep</Button>
          <Button variant="danger" type="submit" form="reason-form" loading={mutation.isPending}>
            {confirm}
          </Button>
        </div>
      }
    >
      <form
        id="reason-form"
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed.length >= 3) onSubmit(trimmed);
        }}
      >
        <p>{text}</p>
        <Textarea
          label="Reason"
          required
          minLength={3}
          maxLength={200}
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={reason && trimmed.length < 3 ? 'At least 3 characters' : undefined}
        />
        {mutation.error && (
          <p className="field-error" role="alert">
            {mutation.error.message}
          </p>
        )}
      </form>
    </Modal>
  );
}

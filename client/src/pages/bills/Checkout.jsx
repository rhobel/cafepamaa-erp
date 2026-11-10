import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatINR, toPaise, toRupees } from '../../money.js';
import { Button, Input, Modal, useToast } from '../../components/ui.jsx';
import { Icon } from '../../components/icons.jsx';
import './Checkout.css';

// Loads the bill and moves it to checkout if still open. Totals always come from the server.
async function loadCheckout(id) {
  const bill = await api(`/bills/${id}`);
  if (bill.status === 'open') return api(`/bills/${id}/checkout`, { method: 'POST' });
  if (bill.status === 'billing') {
    const calc = await api(`/bills/${id}/calculate`, { method: 'POST', body: { discount: null } });
    return { bill, calc };
  }
  return { bill, calc: null };
}

/** Merge identical lines (name + unit price + add-on set) across rounds, skipping voided items. */
function aggregate(rounds = []) {
  const lines = new Map();
  for (const it of rounds.flatMap((r) => r.items)) {
    if (it.isVoided) continue;
    const addOns = [...(it.addOns ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    const key = JSON.stringify([it.name, it.price, addOns.map((a) => [a.name, a.price])]);
    const line = lines.get(key);
    if (line) {
      line.qty += it.qty;
      line.amount += it.lineTotal;
    } else {
      const rate = it.price + addOns.reduce((s, a) => s + a.price, 0);
      lines.set(key, { key, name: it.name, addOns, rate, qty: it.qty, amount: it.lineTotal });
    }
  }
  return [...lines.values()];
}

const signed = (paise) =>
  paise === 0 ? '0.00' : `${paise < 0 ? '−' : '+'}${(Math.abs(paise) / 100).toFixed(2)}`;

/** Returns { discount } for the API, or { error } for input the server shouldn't see. */
function parseDiscount(type, raw) {
  const v = raw.trim();
  if (!v) return { discount: null };
  if (type === 'percent') {
    if (!/^\d+(\.\d{1,2})?$/.test(v)) return { error: 'Enter a percentage with up to 2 decimals' };
    return { discount: { type, value: Number(v) } };
  }
  const paise = toPaise(v);
  if (Number.isNaN(paise)) return { error: 'Enter a valid rupee amount (up to 2 decimals)' };
  return { discount: { type, value: paise } };
}

export function CheckoutPage() {
  const { billId } = useParams();
  const query = useQuery({
    queryKey: ['checkout', billId],
    queryFn: () => loadCheckout(billId),
    retry: (n, err) => err.status >= 500 && n < 2,
    refetchOnWindowFocus: false,
  });

  if (query.isPending) {
    return (
      <div className="panel pad" aria-busy="true">
        <span className="skeleton" />
      </div>
    );
  }
  if (query.isError) {
    const notFound = query.error.status === 404;
    return (
      <div className="panel pad stack">
        <p>{notFound ? 'Bill not found.' : `Could not open checkout: ${query.error.message}`}</p>
        <div className="row">
          {!notFound && <Button onClick={() => query.refetch()}>Retry</Button>}
          <Link to="/bills">Back to running bills</Link>
        </div>
      </div>
    );
  }

  const { bill, calc } = query.data;
  if (!calc) {
    return (
      <div className="panel pad stack">
        <p>
          Bill {bill.billNumber} is {bill.status === 'paid' ? 'already paid' : 'cancelled'}; there
          is nothing to check out.
        </p>
        <Link to="/bills">Back to running bills</Link>
      </div>
    );
  }
  return <Checkout bill={bill} baseCalc={calc} />;
}

function Checkout({ bill, baseCalc }) {
  const { user } = useAuth();
  const [type, setType] = useState('percent');
  const [value, setValue] = useState('');
  // Server results are tagged with the discount they were computed for, so state is only set
  // from async callbacks and "pending" / "error" are derived for the current input.
  const [result, setResult] = useState(null); // { key, calc } — last good calc for a discount
  const [failure, setFailure] = useState(null); // { key, message }
  const [confirmCancel, setConfirmCancel] = useState(false);
  const seq = useRef(0);

  const parsed = parseDiscount(type, value);
  const discountKey = JSON.stringify(parsed.discount);

  useEffect(() => {
    const mine = ++seq.current; // only the latest request may apply its result
    if (!parsed.discount) return;
    const { discount } = parsed;
    const t = setTimeout(() => {
      api(`/bills/${bill._id}/calculate`, { method: 'POST', body: { discount } })
        .then((calc) => mine === seq.current && setResult({ key: discountKey, calc }))
        .catch((e) => mine === seq.current && setFailure({ key: discountKey, message: e.message }));
    }, 300);
    return () => clearTimeout(t);
    // discountKey captures parsed.discount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discountKey, bill._id]);

  const serverError = failure?.key === discountKey ? failure.message : null;
  const pending = !!parsed.discount && result?.key !== discountKey && !serverError;
  // Empty input = the no-discount calc from load; otherwise keep the last good server totals.
  const c = value.trim() === '' ? baseCalc : (result?.calc ?? baseCalc);
  const lines = aggregate(bill.rounds);
  const who = bill.customerName || bill.customerMobile;
  const incl = c.pricesIncludeTax ? ' (incl.)' : '';
  const discountError = parsed.error || serverError;

  return (
    <div className="checkout">
      <section className="panel pad checkout-bill" aria-labelledby="checkout-title">
        <h2 id="checkout-title" className="checkout-title">
          Bill {bill.billNumber} · Table {bill.tableNumber}
          {who && ` · ${who}`}
        </h2>

        <ul className="checkout-lines">
          {lines.map((l) => (
            <li key={l.key}>
              <span className="checkout-name">
                {l.name}
                {l.addOns.length > 0 && (
                  <span className="muted"> + {l.addOns.map((a) => a.name).join(', ')}</span>
                )}
              </span>
              <span className="num muted">
                {l.qty} × {formatINR(l.rate)}
              </span>
              <span className="num">{formatINR(l.amount)}</span>
            </li>
          ))}
        </ul>

        <div className={`checkout-totals${pending ? ' is-pending' : ''}`} aria-busy={pending}>
          <div className="checkout-row">
            <span>Subtotal</span>
            <span className="num">{formatINR(c.subtotal)}</span>
          </div>

          <div className="checkout-row checkout-discount">
            <div className="checkout-discount-field">
              <span>Discount</span>
              <div className="seg" role="group" aria-label="Discount type">
                {[
                  ['percent', '%'],
                  ['flat', '₹'],
                ].map(([t, label]) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={type === t}
                    aria-label={t === 'percent' ? 'Percent' : 'Rupees'}
                    onClick={() => setType(t)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input
                className={`input checkout-discount-input${discountError ? ' input-error' : ''}`}
                inputMode="decimal"
                placeholder="0"
                aria-label={type === 'percent' ? 'Discount percent' : 'Discount in rupees'}
                aria-invalid={!!discountError || undefined}
                aria-describedby="discount-msg"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  // Cleared = no discount is now the last good state, so a later invalid entry
                  // falls back to no-discount totals, not an older discount.
                  if (e.target.value.trim() === '') setResult({ key: 'null', calc: baseCalc });
                }}
              />
            </div>
            <span className="num">
              {c.discount?.amount ? `−${formatINR(c.discount.amount)}` : formatINR(0)}
            </span>
          </div>
          <div id="discount-msg" className={discountError ? 'field-error' : 'field-hint'}>
            {discountError ||
              (user?.role === 'admin'
                ? 'No limit'
                : `Your limit: ${user?.maxDiscountPercent ?? 0}%`)}
          </div>

          <div className="checkout-row">
            <span>Taxable</span>
            <span className="num">{formatINR(c.taxableAmount)}</span>
          </div>
          <div className="checkout-row">
            <span>
              CGST {c.cgstRate}%{incl}
            </span>
            <span className="num">{formatINR(c.cgst)}</span>
          </div>
          <div className="checkout-row">
            <span>
              SGST {c.sgstRate}%{incl}
            </span>
            <span className="num">{formatINR(c.sgst)}</span>
          </div>
          <div className="checkout-row">
            <span>Round-off</span>
            <span className="num">{signed(c.roundOff)}</span>
          </div>
          <div className="checkout-row checkout-grand">
            <span>GRAND TOTAL</span>
            <span className="num">{formatINR(c.grandTotal)}</span>
          </div>
          <div className="checkout-foot muted" aria-live="polite">
            {pending ? 'Recalculating…' : c.pricesIncludeTax ? 'Prices include GST' : ''}
          </div>
        </div>
      </section>

      <PaymentPanel
        bill={bill}
        calc={c}
        blocked={pending || !!discountError}
        onCancel={() => setConfirmCancel(true)}
      />

      {confirmCancel && <CancelCheckout bill={bill} onClose={() => setConfirmCancel(false)} />}
    </div>
  );
}

const METHODS = [
  ['cash', 'Cash'],
  ['upi', 'UPI'],
  ['card', 'Card'],
];
const MAX_ROWS = 5;
let rowSeq = 0;
const newRow = (amount = '') => ({ id: ++rowSeq, method: 'cash', amount, extra: '' });

/** Validates one payment row (amounts in rupee strings). `extra` = cash received or reference. */
function checkRow(r) {
  const amount = toPaise(r.amount);
  const cash = r.method === 'cash';
  const tendered = cash && r.extra.trim() ? toPaise(r.extra) : null; // empty = exact cash
  let error = null;
  if (!(amount > 0)) error = 'Enter an amount above ₹0';
  else if (Number.isNaN(tendered)) error = 'Enter a valid amount received';
  else if (tendered !== null && tendered < amount) error = 'Received is less than the amount';
  else if (!cash && r.extra.trim().length > 60) error = 'Reference can be at most 60 characters';
  return { ...r, paise: amount > 0 ? amount : 0, tendered, error };
}

// Only payment arithmetic (sums of paise) happens here; every tax/discount figure is the server's.
function PaymentPanel({ bill, calc, blocked, onCancel }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const total = calc.grandTotal;
  const [mode, setMode] = useState('cash');
  const [extra, setExtra] = useState(''); // single mode: cash received or reference
  const [rows, setRows] = useState([]);
  // One key per checkout visit: retries after a network error replay instead of double-billing.
  const idempotencyKey = useRef(crypto.randomUUID());
  const inFlight = useRef(false);

  const invoice = useMutation({
    mutationFn: (body) => api(`/bills/${bill._id}/invoice`, { method: 'POST', body }),
    onSuccess: (inv) => {
      qc.removeQueries({ queryKey: ['checkout', bill._id] });
      qc.invalidateQueries({ queryKey: ['bills'] });
      toast(`Invoice ${inv.invoiceNumber} generated`);
      navigate(`/invoices/${inv._id}`, { state: { fresh: true } });
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });

  const split = mode === 'split';
  // A ₹0 bill (e.g. 100% discount) is settled with no payment rows.
  const pays =
    total === 0
      ? []
      : (split ? rows : [{ id: 0, method: mode, amount: toRupees(total), extra }]).map(checkRow);
  const paid = pays.reduce((s, p) => s + p.paise, 0);
  const balance = total - paid;
  const change = pays.reduce((s, p) => s + (p.tendered > p.paise ? p.tendered - p.paise : 0), 0);
  const hasCash = pays.some((p) => p.method === 'cash');
  const canSubmit =
    !blocked &&
    balance === 0 &&
    pays.every((p) => !p.error) &&
    !invoice.isPending &&
    !invoice.isSuccess;

  const pickMode = (m) => {
    if (m === mode) return;
    setMode(m);
    setExtra('');
    if (m === 'split') setRows([newRow(toRupees(total))]);
  };
  const updateRow = (id, patch) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, newRow(balance > 0 ? toRupees(balance) : '')]);

  const submit = () => {
    if (inFlight.current || !canSubmit) return; // guards a double tap before the re-render
    inFlight.current = true;
    const discount = calc.discount
      ? { type: calc.discount.type, value: calc.discount.value }
      : null;
    const payments = pays.map((p) => {
      const out = { method: p.method, amount: p.paise };
      if (p.method === 'cash') {
        if (p.tendered !== null) out.tendered = p.tendered;
      } else if (p.extra.trim()) out.reference = p.extra.trim();
      return out;
    });
    invoice.mutate({ discount, payments, idempotencyKey: idempotencyKey.current });
  };

  const single = pays[0];
  if (total === 0) {
    return (
      <aside className="panel pad checkout-pay stack" aria-labelledby="pay-title">
        <h2 id="pay-title" className="checkout-title">
          Payment
        </h2>
        <div className="checkout-pay-total num">{formatINR(0)}</div>
        <p className="muted">Nothing to collect — the bill total is ₹0.</p>
        {invoice.error && (
          <div className="form-error" role="alert">
            {invoice.error.message}
          </div>
        )}
        <Button
          variant="primary"
          onClick={submit}
          disabled={!canSubmit}
          loading={invoice.isPending}
        >
          Generate invoice
        </Button>
        <Button onClick={onCancel} disabled={invoice.isPending}>
          Cancel checkout
        </Button>
      </aside>
    );
  }
  return (
    <aside className="panel pad checkout-pay stack" aria-labelledby="pay-title">
      <h2 id="pay-title" className="checkout-title">
        Payment
      </h2>
      <div>
        <div className="muted">Grand total</div>
        <div className="checkout-pay-total num">{formatINR(total)}</div>
      </div>

      <div className="seg pay-seg" role="group" aria-label="Payment method">
        {[...METHODS, ['split', 'Split']].map(([m, label]) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => pickMode(m)}>
            {label}
          </button>
        ))}
      </div>

      {!split && mode === 'cash' && (
        <Input
          label="Cash received (₹)"
          inputMode="decimal"
          placeholder={toRupees(total)}
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          error={extra.trim() ? single.error : null}
          hint="Leave empty for exact cash"
        />
      )}
      {!split && mode !== 'cash' && (
        <Input
          label="Reference (optional)"
          maxLength={60}
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          error={single.error}
        />
      )}

      {split && (
        <div className="pay-rows">
          {pays.map((p, i) => (
            <div key={p.id} className="pay-row">
              <select
                className="input"
                aria-label={`Payment ${i + 1} method`}
                value={p.method}
                onChange={(e) => updateRow(p.id, { method: e.target.value, extra: '' })}
              >
                {METHODS.map(([m, label]) => (
                  <option key={m} value={m}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                className={`input num${p.error && !(p.paise > 0) ? ' input-error' : ''}`}
                inputMode="decimal"
                placeholder="Amount"
                aria-label={`Payment ${i + 1} amount in rupees`}
                value={p.amount}
                onChange={(e) => updateRow(p.id, { amount: e.target.value })}
              />
              <input
                className="input"
                inputMode={p.method === 'cash' ? 'decimal' : 'text'}
                maxLength={p.method === 'cash' ? undefined : 60}
                placeholder={p.method === 'cash' ? 'Received' : 'Reference'}
                aria-label={`Payment ${i + 1} ${p.method === 'cash' ? 'cash received' : 'reference'}`}
                value={p.extra}
                onChange={(e) => updateRow(p.id, { extra: e.target.value })}
              />
              <button
                type="button"
                className="btn icon-btn"
                aria-label={`Remove payment ${i + 1}`}
                disabled={rows.length === 1}
                onClick={() => setRows((rs) => rs.filter((r) => r.id !== p.id))}
              >
                <Icon name="close" size={16} />
              </button>
              {p.error && <div className="field-error pay-row-error">{p.error}</div>}
            </div>
          ))}
          {rows.length < MAX_ROWS && (
            <Button className="checkout-wide" onClick={addRow}>
              + Add payment
            </Button>
          )}
        </div>
      )}

      <div className="pay-summary" aria-live="polite">
        <div className="checkout-row">
          <span>Paid</span>
          <span className="num">{formatINR(paid)}</span>
        </div>
        <div className={`checkout-row${balance !== 0 ? ' pay-due' : ''}`}>
          <span>{balance < 0 ? 'Overpaid' : 'Balance due'}</span>
          <span className="num">{formatINR(Math.abs(balance))}</span>
        </div>
        {hasCash && (
          <div className="checkout-row">
            <span>Change to return</span>
            <span className="num">{formatINR(change)}</span>
          </div>
        )}
      </div>

      {invoice.error && (
        <p className="field-error" role="alert">
          {invoice.error.message}
        </p>
      )}
      <Button
        variant="primary"
        className="checkout-wide"
        disabled={!canSubmit}
        loading={invoice.isPending}
        onClick={submit}
      >
        Generate invoice
      </Button>
      <Button className="checkout-wide" disabled={invoice.isPending} onClick={onCancel}>
        Cancel checkout
      </Button>
    </aside>
  );
}

function CancelCheckout({ bill, onClose }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const cancel = useMutation({
    mutationFn: () => api(`/bills/${bill._id}/cancel-checkout`, { method: 'POST' }),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ['checkout', bill._id] });
      qc.invalidateQueries({ queryKey: ['bills'] });
      toast(`Checkout cancelled · ${bill.billNumber} is open again`);
      navigate(`/bills/${bill._id}`);
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Cancel checkout?"
      footer={
        <div className="actions">
          <Button onClick={onClose}>Keep checkout</Button>
          <Button variant="dark" loading={cancel.isPending} onClick={() => cancel.mutate()}>
            Cancel checkout
          </Button>
        </div>
      }
    >
      <p>
        Bill {bill.billNumber} goes back to open and Table {bill.tableNumber} back to occupied. Any
        discount entered here is discarded.
      </p>
      {cancel.error && (
        <p className="field-error" role="alert">
          {cancel.error.message}
        </p>
      )}
    </Modal>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { formatINR } from '../../money.js';
import { Badge, Button, Checkbox, Input, Modal, Textarea, useToast } from '../../components/ui.jsx';
import { LiveTables } from '../Tables.jsx';
import { LoadError, Loading, Rounds } from './MyOrders.jsx';
import './Pos.css';

// POS steps live in the query string so a refresh lands on the same step:
//   /pos                       → mobile lookup
//   /pos?mobile=…              → table picker
//   /pos?mobile=…&table=<id>   → menu & cart, new bill
//   /pos?bill=<id>             → menu & cart, add to existing bill
export function PosPage() {
  const [params] = useSearchParams();
  const bill = params.get('bill');
  const mobile = params.get('mobile');
  const table = params.get('table');
  if (bill) return <BillMenu key={bill} billId={bill} />;
  if (mobile && table) return <NewBillMenu key={mobile + table} mobile={mobile} tableId={table} />;
  if (mobile) return <PickTable mobile={mobile} />;
  return <Start />;
}

const MOBILE = /^[6-9]\d{9}$/;

const useCustomer = (mobile) =>
  useQuery({
    queryKey: ['customer', mobile],
    queryFn: () => api(`/customers?mobile=${mobile}`),
    enabled: MOBILE.test(mobile ?? ''),
  });

const formatDate = (d) =>
  new Date(d).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

/* ---------- Step 1: mobile lookup ---------- */

function Start() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [mobile, setMobile] = useState('');
  const [name, setName] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const valid = MOBILE.test(mobile);
  const lookup = useCustomer(valid ? mobile : null); // auto-searches at 10 valid digits

  const register = useMutation({
    mutationFn: () =>
      api('/customers', { method: 'POST', body: { mobile, name: name.trim() || undefined } }),
    onSuccess: (customer) => {
      qc.setQueryData(['customer', mobile], { customer, activeBill: null });
      navigate(`/pos?mobile=${mobile}`);
    },
    onError: (err) => {
      if (err.status === 409) qc.invalidateQueries({ queryKey: ['customer', mobile] });
      toast(err.message, 'error');
    },
  });

  const error =
    (submitted || mobile.length === 10) && !valid
      ? 'Enter a 10-digit mobile number starting with 6–9'
      : null;
  const found = lookup.data?.customer;
  const active = lookup.data?.activeBill;

  return (
    <div className="pos-start stack">
      <form
        className="pos-search"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(true);
          if (valid) lookup.refetch();
        }}
        noValidate
      >
        <Input
          label="Mobile number"
          type="tel"
          inputMode="numeric"
          autoComplete="off"
          placeholder="98765 43210"
          maxLength={10}
          value={mobile}
          onChange={(e) => {
            setMobile(e.target.value.replace(/\D/g, '').slice(0, 10));
            setSubmitted(false);
          }}
          error={error}
          autoFocus
        />
        <Button type="submit" loading={lookup.isFetching}>
          Search
        </Button>
      </form>

      {lookup.isError && <LoadError query={lookup} />}

      {found && (
        <div className="panel pad stack pos-card">
          <div>
            <b>
              {found.name || 'Guest'} · <span className="mono">{found.mobile}</span>
            </b>
            <div className="muted">
              {found.totalVisits} {found.totalVisits === 1 ? 'visit' : 'visits'}
              {found.lastVisitAt && ` · Last: ${formatDate(found.lastVisitAt)}`}
            </div>
          </div>
          {!active ? (
            <Button variant="primary" onClick={() => navigate(`/pos?mobile=${found.mobile}`)}>
              Choose table
            </Button>
          ) : active.status === 'open' ? (
            <>
              <div className="pos-notice">
                Active bill {active.billNumber} · Table {active.tableNumber} ·{' '}
                {formatINR(active.subtotal)}
              </div>
              <Button variant="primary" onClick={() => navigate(`/pos?bill=${active._id}`)}>
                Add to this bill
              </Button>
            </>
          ) : (
            <div className="pos-notice">
              Bill {active.billNumber} · Table {active.tableNumber} is at checkout — new items
              can&apos;t be added.
            </div>
          )}
        </div>
      )}

      {lookup.data && !found && (
        <form
          className="panel pad stack pos-card"
          onSubmit={(e) => {
            e.preventDefault();
            register.mutate();
          }}
        >
          <b>New customer · {mobile}</b>
          <Input
            label="Name (optional)"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button variant="primary" type="submit" loading={register.isPending}>
            Register &amp; Continue
          </Button>
        </form>
      )}
    </div>
  );
}

/* ---------- Step 2: table picker ---------- */

function PickTable({ mobile }) {
  const navigate = useNavigate();
  const lookup = useCustomer(mobile);

  if (!MOBILE.test(mobile)) return <Navigate to="/pos" replace />;
  if (lookup.isPending) return <Loading />;
  if (lookup.isError) return <LoadError query={lookup} />;
  const { customer, activeBill } = lookup.data;
  if (!customer) return <Navigate to="/pos" replace />;
  if (activeBill) return <Navigate to={`/pos?bill=${activeBill._id}`} replace />;

  return (
    <div className="stack">
      <div className="pos-head">
        <div>
          <b>Select table</b>
          <div className="muted">
            for {customer.name || 'Guest'} · {mobile}
          </div>
        </div>
        <span className="grow" />
        <Button onClick={() => navigate('/pos')}>Back</Button>
      </div>
      <LiveTables onPick={(t) => navigate(`/pos?mobile=${mobile}&table=${t._id}`)} />
    </div>
  );
}

/* ---------- Step 3: menu & cart ---------- */

function NewBillMenu({ mobile, tableId }) {
  const lookup = useCustomer(mobile);
  const tables = useQuery({ queryKey: ['tables'], queryFn: () => api('/tables') });

  if (!MOBILE.test(mobile)) return <Navigate to="/pos" replace />;
  if (lookup.isPending || tables.isPending) return <Loading />;
  if (lookup.isError) return <LoadError query={lookup} />;
  if (tables.isError) return <LoadError query={tables} />;
  const { customer, activeBill } = lookup.data;
  if (!customer) return <Navigate to="/pos" replace />;
  if (activeBill) return <Navigate to={`/pos?bill=${activeBill._id}`} replace />;
  const table = tables.data.find((t) => t._id === tableId);
  if (!table) return <Navigate to={`/pos?mobile=${mobile}`} replace />;

  return (
    <OrderScreen
      customerId={customer._id}
      customerName={customer.name}
      mobile={mobile}
      tableId={table._id}
      tableNumber={table.tableNumber}
      bill={null}
    />
  );
}

function BillMenu({ billId }) {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['bill', billId], queryFn: () => api(`/bills/${billId}`) });

  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError query={q} />;
  const b = q.data;
  if (b.status !== 'open') {
    return (
      <div className="center-msg stack">
        <p>
          Bill {b.billNumber} · Table {b.tableNumber} is{' '}
          {b.status === 'billing' ? 'at checkout' : 'closed'} — new items can&apos;t be added.
        </p>
        <div>
          <Button onClick={() => navigate('/pos')}>New customer</Button>
        </div>
      </div>
    );
  }

  return (
    <OrderScreen
      customerId={b.customerId}
      customerName={b.customerName}
      mobile={b.customerMobile}
      tableId={b.tableId}
      tableNumber={b.tableNumber}
      bill={b}
    />
  );
}

// Cart = { lines, key }. `key` is the idempotency key of the current attempt: kept across retries
// of the same cart (and refreshes), reset whenever the cart changes.
const EMPTY = { lines: [], key: null };

function loadCart(k) {
  try {
    return JSON.parse(sessionStorage.getItem(k)) ?? EMPTY;
  } catch {
    return EMPTY;
  }
}

function saveCart(k, cart) {
  try {
    if (cart.lines.length) sessionStorage.setItem(k, JSON.stringify(cart));
    else sessionStorage.removeItem(k);
  } catch {
    // storage blocked/full: the cart still lives in React state
  }
}

const unitPrice = (price, addOns) => price + addOns.reduce((s, a) => s + a.price, 0);
const lineTotal = (l) => unitPrice(l.price, l.addOns) * l.qty;
const MAX_QTY = 99;

function OrderScreen({ customerId, customerName, mobile, tableId, tableNumber, bill }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  // A customer has at most one active bill, so a new-bill cart is keyed by customer and survives a table change.
  const storeKey = bill ? `pos-cart:b:${bill._id}` : `pos-cart:c:${customerId}`;
  const [cart, setCart] = useState(() => loadCart(storeKey));
  useEffect(() => saveCart(storeKey, cart), [storeKey, cart]);

  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [picking, setPicking] = useState(null);
  const searchRef = useRef(null);

  // "/" focuses menu search (web-flow §12)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api('/categories') });
  const items = useQuery({ queryKey: ['menu-items', 'pos'], queryFn: () => api('/menu-items') });
  const categories = (Array.isArray(cats.data) ? cats.data : []).filter((c) => c.isActive);
  const activeCat = new Set(categories.map((c) => c._id));
  const term = search.trim().toLowerCase();
  const shown = (items.data ?? []).filter(
    (it) =>
      (!cats.data || activeCat.has(it.categoryId)) &&
      (tab === 'all' || it.categoryId === tab) &&
      (!term || it.name.toLowerCase().includes(term)),
  );

  const update = (fn) => setCart((c) => ({ lines: fn(c.lines), key: null }));
  const addLine = (item, addOns = [], qty = 1, instructions = '') => {
    const sig = [item._id, ...addOns.map((a) => a._id).sort(), instructions].join('|');
    update((lines) =>
      lines.some((l) => l.sig === sig)
        ? lines.map((l) => (l.sig === sig ? { ...l, qty: Math.min(l.qty + qty, MAX_QTY) } : l))
        : [
            ...lines,
            {
              sig,
              menuItemId: item._id,
              name: item.name,
              price: item.price,
              addOns: addOns.map(({ _id, name, price }) => ({ _id, name, price })),
              qty,
              instructions,
            },
          ],
    );
  };
  const setQty = (sig, qty) =>
    update((lines) =>
      qty < 1
        ? lines.filter((l) => l.sig !== sig)
        : lines.map((l) => (l.sig === sig ? { ...l, qty } : l)),
    );

  const confirm = useMutation({
    mutationFn: (body) => api('/bills/orders', { method: 'POST', body }),
    onSuccess: ({ bill: b, orderNumber }) => {
      saveCart(storeKey, EMPTY);
      ['tables', 'bills', 'bill', 'customer'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
      toast(`Order ${orderNumber} saved to Bill ${b.billNumber} · Table ${b.tableNumber}`);
      navigate('/pos');
    },
    onError: (err, body) => {
      const data = err.data ?? {};
      if (err.status === 422 && data.unavailable?.length) {
        const gone = new Set(data.unavailable.map(String));
        const names = [
          ...new Set(cart.lines.filter((l) => gone.has(l.menuItemId)).map((l) => l.name)),
        ];
        update((lines) => lines.filter((l) => !gone.has(l.menuItemId)));
        qc.invalidateQueries({ queryKey: ['menu-items'] });
        toast(
          `${names.join(', ') || 'Some items'} ${names.length > 1 ? 'are' : 'is'} no longer available — removed from cart.`,
          'error',
        );
      } else if (err.status === 409 && data.billId) {
        // Customer already has an open bill: move the cart onto it.
        saveCart(`pos-cart:b:${data.billId}`, { lines: cart.lines, key: null });
        saveCart(storeKey, EMPTY);
        toast(err.message, 'info');
        navigate(`/pos?bill=${data.billId}`, { replace: true });
      } else if (err.status === 409 && !body.billId) {
        // Table was just taken: back to the grid; cart is kept (keyed by customer).
        qc.invalidateQueries({ queryKey: ['tables'] });
        toast(err.message, 'error');
        navigate(`/pos?mobile=${mobile}`, { replace: true });
      } else {
        // e.g. 409 bill moved to checkout → refetch so BillMenu shows the blocked state
        if (err.status === 409) qc.invalidateQueries({ queryKey: ['bill', body.billId] });
        toast(err.message, 'error');
      }
    },
  });

  const submit = () => {
    const key = cart.key ?? crypto.randomUUID();
    if (!cart.key) setCart((c) => ({ ...c, key }));
    confirm.mutate({
      customerId,
      tableId: bill ? undefined : tableId,
      billId: bill?._id ?? null,
      items: cart.lines.map((l) => ({
        menuItemId: l.menuItemId,
        qty: l.qty,
        addOnIds: l.addOns.map((a) => a._id),
        instructions: l.instructions,
      })),
      idempotencyKey: key,
    });
  };

  const round = cart.lines.reduce((s, l) => s + lineTotal(l), 0);

  let menu;
  if (items.isPending) menu = <Loading />;
  else if (items.isError) menu = <LoadError query={items} />;
  else if (!shown.length) {
    menu = (
      <div className="panel pad muted">{term ? 'No items match' : 'No items in this category'}</div>
    );
  } else {
    menu = (
      <div className="pos-items">
        {shown.map((it) => (
          <button
            key={it._id}
            type="button"
            className="pos-item"
            disabled={!it.isAvailable}
            onClick={() => (it.addOns.length ? setPicking(it) : addLine(it))}
          >
            {it.imageUrl ? (
              <img className="pos-ph" src={it.imageUrl} alt="" loading="lazy" />
            ) : (
              <span className="pos-ph" aria-hidden="true" />
            )}
            <b>{it.name}</b>
            <span className="pos-pr">
              {it.isAvailable ? (
                <>
                  {formatINR(it.price)}
                  <span className="pos-add" aria-hidden="true">
                    +
                  </span>
                </>
              ) : (
                <Badge>Unavailable</Badge>
              )}
            </span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="pos-layout">
      <div className="stack pos-menu">
        <div className="pos-head">
          <b>
            Table {tableNumber} · {customerName || 'Guest'}
            {bill && ` · ${bill.billNumber}`}
          </b>
          <span className="grow" />
          <Button onClick={() => navigate(bill ? '/pos' : `/pos?mobile=${mobile}`)}>Change</Button>
        </div>
        <Input
          ref={searchRef}
          type="search"
          aria-label="Search items"
          placeholder="Search items…  ( / )"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="pos-tabs" role="group" aria-label="Categories">
          {[{ _id: 'all', name: 'All' }, ...categories].map((c) => (
            <button
              key={c._id}
              type="button"
              className={tab === c._id ? 'on' : undefined}
              aria-pressed={tab === c._id}
              onClick={() => setTab(c._id)}
            >
              {c.name}
            </button>
          ))}
        </div>
        {menu}
      </div>

      <aside className="panel pos-cart">
        <h3>Cart{bill && ` (Round ${bill.rounds.length + 1})`}</h3>
        {cart.lines.length === 0 ? (
          <p className="muted">Tap items to add them.</p>
        ) : (
          <ul className="pos-lines">
            {cart.lines.map((l) => (
              <li key={l.sig}>
                <div className="pos-line-top">
                  <b>{l.name}</b>
                  <span className="num">{formatINR(lineTotal(l))}</span>
                </div>
                {l.addOns.map((a) => (
                  <div key={a._id} className="muted">
                    + {a.name} {formatINR(a.price)}
                  </div>
                ))}
                {l.instructions && <div className="muted">“{l.instructions}”</div>}
                <div className="pos-line-top">
                  <Stepper label={l.name} value={l.qty} onChange={(q) => setQty(l.sig, q)} />
                  <Button variant="danger" onClick={() => setQty(l.sig, 0)}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="hr" />
        <div className="pos-line-top">
          <span>This round</span>
          <b className="num">{formatINR(round)}</b>
        </div>
        <div className="pos-line-top">
          <span>Bill so far</span>
          <b className="num">{formatINR((bill?.subtotal ?? 0) + round)}</b>
        </div>
        {bill?.rounds.length > 0 && (
          <details className="pos-prev">
            <summary>Previous rounds ({bill.rounds.length})</summary>
            <Rounds rounds={bill.rounds} />
          </details>
        )}
        <Button
          variant="primary"
          className="btn-block"
          disabled={!cart.lines.length}
          loading={confirm.isPending}
          onClick={submit}
        >
          Confirm Order
        </Button>
      </aside>

      {picking && <AddOnModal item={picking} onAdd={addLine} onClose={() => setPicking(null)} />}
    </div>
  );
}

function Stepper({ label, value, onChange }) {
  return (
    <div className="pos-qty">
      <button
        type="button"
        className="btn icon-btn"
        aria-label={`Decrease ${label}`}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <span aria-live="polite">{value}</span>
      <button
        type="button"
        className="btn icon-btn"
        aria-label={`Increase ${label}`}
        disabled={value >= MAX_QTY}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}

function AddOnModal({ item, onAdd, onClose }) {
  const [picked, setPicked] = useState([]);
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');
  const addOns = item.addOns.filter((a) => picked.includes(a._id));

  return (
    <Modal
      open
      onClose={onClose}
      title={item.name}
      footer={
        <div className="actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              onAdd(item, addOns, qty, notes.trim());
              onClose();
            }}
          >
            Add · {formatINR(unitPrice(item.price, addOns) * qty)}
          </Button>
        </div>
      }
    >
      <div className="stack">
        <fieldset className="pos-fieldset">
          <legend className="lbl">Add-ons</legend>
          {item.addOns.map((a) => (
            <Checkbox
              key={a._id}
              label={`${a.name} (+${formatINR(a.price)})`}
              checked={picked.includes(a._id)}
              onChange={(e) =>
                setPicked((p) => (e.target.checked ? [...p, a._id] : p.filter((x) => x !== a._id)))
              }
            />
          ))}
        </fieldset>
        <div>
          <div className="lbl">Quantity</div>
          <Stepper label={item.name} value={qty} onChange={(q) => setQty(Math.max(1, q))} />
        </div>
        <Textarea
          label="Special instructions"
          placeholder="Less spicy"
          maxLength={200}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
    </Modal>
  );
}

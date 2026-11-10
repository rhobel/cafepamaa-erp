// Printable invoice (requirement §4.6). Renders the frozen invoice snapshot only — never recalculates.
import { formatINR } from '../../money.js';
import './Invoice.css';

const num = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** 16000 → "160.00" (tight columns; grand total uses formatINR) */
const amt = (paise) => num.format((paise ?? 0) / 100);
const signed = (paise) => (paise > 0 ? '+' : paise < 0 ? '−' : '') + amt(Math.abs(paise ?? 0));

const ist = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
export const formatIST = (d) => ist.format(new Date(d));

const METHOD = { cash: 'Cash', upi: 'UPI', card: 'Card' };

function summaryRows(inv) {
  const incl = inv.pricesIncludeTax ? ' (incl.)' : '';
  const d = inv.discount;
  const rows = [['Subtotal', amt(inv.subtotal)]];
  if (d?.amount > 0) {
    rows.push([d.type === 'percent' ? `Discount ${d.value}%` : 'Discount', `−${amt(d.amount)}`]);
  }
  rows.push(
    ['Taxable value', amt(inv.taxableAmount)],
    [`CGST ${inv.cgstRate ?? inv.gstRate / 2}%${incl}`, amt(inv.cgst)],
    [`SGST ${inv.sgstRate ?? inv.gstRate / 2}%${incl}`, amt(inv.sgst)],
  );
  if (inv.roundOff) rows.push(['Round-off', signed(inv.roundOff)]);
  return rows;
}

function Payments({ payments }) {
  return payments.map((p, i) => (
    <div key={i} className="inv-pay">
      <div className="inv-l">
        <span>{METHOD[p.method] ?? p.method}</span>
        <span className="inv-n">{amt(p.amount)}</span>
      </div>
      {p.method === 'cash' && p.tendered != null && (
        <div className="inv-l inv-sub">
          <span>Tendered {amt(p.tendered)}</span>
          <span>Change {amt(p.change)}</span>
        </div>
      )}
      {p.reference && <div className="inv-sub">Ref: {p.reference}</div>}
    </div>
  ));
}

export function InvoiceDocument({ invoice: inv, format = '80mm', duplicate = false }) {
  const r = inv.restaurant ?? {};
  const a4 = format === 'A4';
  const meta = [
    ['Invoice No', inv.invoiceNumber],
    ['Date', formatIST(inv.createdAt)],
    ['Bill No', inv.billNumber],
    ['Table', inv.tableNumber],
    inv.customer?.name && ['Customer', inv.customer.name],
    inv.customer?.mobile && ['Mobile', inv.customer.mobile],
  ].filter(Boolean);

  const header = (
    <header className="inv-head">
      {r.logoUrl && <img className="inv-logo" src={r.logoUrl} alt="" />}
      <div>
        <h2 className="inv-name">{r.name}</h2>
        {r.address && <div className="inv-addr">{r.address}</div>}
        {r.phone && <div>Ph: {r.phone}</div>}
        {r.gstin && <div>GSTIN: {r.gstin}</div>}
      </div>
    </header>
  );

  return (
    <article className={`inv-doc ${a4 ? 'inv-a4' : 'inv-80'}`}>
      {duplicate && <div className="inv-dup">DUPLICATE COPY</div>}
      {header}
      <div className="inv-title">TAX INVOICE</div>

      <dl className="inv-meta">
        {meta.map(([k, v]) => (
          <div key={k} className="inv-l">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      {a4 ? (
        <table className="inv-items">
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
              <th className="inv-n">Qty</th>
              <th className="inv-n">Rate</th>
              <th className="inv-n">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.items.map((it, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>
                  {it.name}
                  {it.addOns?.map((a) => (
                    <div key={a.name} className="inv-sub">
                      + {a.name} ({amt(a.price)})
                    </div>
                  ))}
                </td>
                <td className="inv-n">{it.qty}</td>
                <td className="inv-n">{amt(it.rate)}</td>
                <td className="inv-n">{amt(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="inv-items">
          {inv.items.map((it, i) => (
            <div key={i} className="inv-item">
              <div className="inv-l">
                <span>{it.name}</span>
                <span className="inv-n">{amt(it.amount)}</span>
              </div>
              {it.addOns?.map((a) => (
                <div key={a.name} className="inv-sub">
                  + {a.name} {amt(a.price)}
                </div>
              ))}
              <div className="inv-sub">
                {it.qty} × {amt(it.rate)}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="inv-totals">
        {summaryRows(inv).map(([k, v]) => (
          <div key={k} className="inv-l">
            <span>{k}</span>
            <span className="inv-n">{v}</span>
          </div>
        ))}
        <div className="inv-l inv-grand">
          <span>GRAND TOTAL</span>
          <span className="inv-n">{formatINR(inv.grandTotal)}</span>
        </div>
      </div>

      <section className="inv-payments">
        <div className="inv-h">Payment</div>
        <Payments payments={inv.payments ?? []} />
        <div className="inv-status">
          Payment status: {(inv.paymentStatus ?? 'paid').toUpperCase()}
        </div>
        {inv.cashierName && <div>Cashier: {inv.cashierName}</div>}
      </section>

      {r.footer && <footer className="inv-foot">{r.footer}</footer>}
    </article>
  );
}

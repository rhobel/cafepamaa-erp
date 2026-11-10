import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { start, makeUser, client } from './setup.js';
import { Invoice } from '../src/models/Invoice.js';
import { RunningBill } from '../src/models/RunningBill.js';
import { MenuItem } from '../src/models/MenuItem.js';
import { Category } from '../src/models/Category.js';
import { todayIST } from '../src/routes/reports.js';

const oid = () => new mongoose.Types.ObjectId();
let ctx, admin, cashier, waiter, cashierUser, otherUser;
let n = 0;

// Exclusive 5% GST; payments default to one cash payment of the grand total.
function makeInvoice({
  createdAt,
  subtotal = 10000,
  discount = 0,
  cashierId,
  payments,
  items,
  billId,
} = {}) {
  n += 1;
  const taxable = subtotal - discount;
  const half = Math.round(taxable * 0.025);
  const grandTotal = taxable + 2 * half;
  return Invoice.create({
    invoiceNumber: `INV/2026-27/${String(n).padStart(5, '0')}`,
    billId: billId ?? oid(),
    billNumber: `RB-${n}`,
    idempotencyKey: `rk${n}`,
    customer: { customerId: oid(), name: 'Asha', mobile: '9876543210' },
    tableNumber: 'T1',
    items: items ?? [{ name: 'Dosa', qty: 1, rate: subtotal, amount: subtotal }],
    subtotal,
    ...(discount && { discount: { type: 'flat', value: discount, amount: discount } }),
    taxableAmount: taxable,
    gstRate: 5,
    cgst: half,
    sgst: half,
    roundOff: 0,
    grandTotal,
    payments: payments ?? [{ method: 'cash', amount: grandTotal }],
    cashierId: cashierId ?? cashierUser._id,
    cashierName: 'cashier',
    createdAt,
  });
}

const report = async (who, type, qs = '') => {
  const r = await who('GET', `/reports/${type}?${qs}`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.data;
};
const sumOf = (docs, f) => docs.reduce((s, d) => s + f(d), 0);

before(async () => {
  ctx = await start();
  await makeUser({ username: 'admin', role: 'admin' });
  cashierUser = await makeUser({ username: 'cashier', role: 'cashier' });
  otherUser = await makeUser({ username: 'cashier2', role: 'cashier' });
  await makeUser({ username: 'waiter', role: 'waiter' });
  [admin, cashier, waiter] = await Promise.all(
    ['admin', 'cashier', 'waiter'].map((u) => client(ctx.base, u)),
  );

  // March 2026 range, with an IST day boundary pair and a ₹0 (fully discounted) invoice.
  await makeInvoice({ createdAt: new Date('2026-03-10T23:30:00+05:30'), subtotal: 10000 });
  await makeInvoice({
    createdAt: new Date('2026-03-11T00:30:00+05:30'),
    subtotal: 20000,
    discount: 2000,
    payments: [
      { method: 'upi', amount: 10000 },
      { method: 'card', amount: 8900 },
    ],
  });
  await makeInvoice({
    createdAt: new Date('2026-03-11T12:00:00+05:30'),
    subtotal: 5000,
    discount: 5000,
    payments: [],
  });
  await makeInvoice({
    createdAt: new Date('2026-03-12T10:00:00+05:30'),
    subtotal: 7000,
    cashierId: otherUser._id,
  });
  // Outside the range.
  await makeInvoice({ createdAt: new Date('2026-04-01T10:00:00+05:30'), subtotal: 99900 });
});
after(() => ctx.stop());

const RANGE = 'from=2026-03-10&to=2026-03-12';
const inRange = () =>
  Invoice.find({
    createdAt: {
      $gte: new Date('2026-03-10T00:00:00+05:30'),
      $lt: new Date('2026-03-13T00:00:00+05:30'),
    },
  }).lean();

test('sales: IST day grouping and totals equal the sum of invoices', async () => {
  const d = await report(admin, 'sales', RANGE);
  assert.deepEqual(
    d.rows.map((r) => [r.date, r.bills]),
    [
      ['2026-03-10', 1],
      ['2026-03-11', 2],
      ['2026-03-12', 1],
    ],
  );
  const invs = await inRange();
  assert.equal(d.totals.bills, invs.length);
  assert.equal(
    d.totals.grandTotal,
    sumOf(invs, (i) => i.grandTotal),
  );
  assert.equal(
    d.totals.subtotal,
    sumOf(invs, (i) => i.subtotal),
  );
  assert.equal(d.totals.discount, 7000);
  assert.equal(
    d.totals.cgst + d.totals.sgst,
    sumOf(invs, (i) => i.cgst + i.sgst),
  );
  assert.deepEqual([d.from, d.to, d.type], ['2026-03-10', '2026-03-12', 'sales']);

  // A single IST day only picks its own invoices.
  const day = await report(admin, 'sales', 'from=2026-03-10&to=2026-03-10');
  assert.equal(day.totals.bills, 1);
  assert.equal(day.totals.subtotal, 10000);
});

test('gst and payments totals match invoices; ₹0 invoice adds no payment row', async () => {
  const invs = await inRange();
  const gst = await report(admin, 'gst', RANGE);
  assert.equal(
    gst.totals.taxable,
    sumOf(invs, (i) => i.taxableAmount),
  );
  assert.equal(
    gst.totals.tax,
    sumOf(invs, (i) => i.cgst + i.sgst),
  );
  assert.equal(gst.rows.length, 3);

  const pay = await report(admin, 'payments', RANGE);
  assert.deepEqual(pay.rows, [
    { method: 'card', count: 1, amount: 8900 },
    { method: 'cash', count: 2, amount: 10500 + 7350 },
    { method: 'upi', count: 1, amount: 10000 },
  ]);
  assert.equal(
    pay.totals.amount,
    sumOf(invs, (i) => i.grandTotal),
  );
  assert.equal(pay.totals.count, 4);

  const upiOnly = await report(admin, 'payments', `${RANGE}&method=upi`);
  assert.deepEqual(upiOnly.rows, [{ method: 'upi', count: 1, amount: 10000 }]);
  // method filter on other reports: invoices having that payment method.
  assert.equal((await report(admin, 'sales', `${RANGE}&method=upi`)).totals.bills, 1);
});

test('items, discounts and cashier filter', async () => {
  const items = await report(admin, 'items', RANGE);
  assert.deepEqual(items.rows, [{ name: 'Dosa', qty: 4, amount: 42000 }]);
  assert.deepEqual(items.totals, { qty: 4, amount: 42000 });

  const disc = await report(admin, 'discounts', RANGE);
  assert.equal(disc.rows.length, 2);
  assert.deepEqual(disc.totals, { count: 2, amount: 7000 });
  assert.deepEqual(Object.keys(disc.rows[0]).sort(), [
    'amount',
    'cashierName',
    'date',
    'invoiceId',
    'invoiceNumber',
    'type',
    'value',
  ]);
  assert.equal(disc.rows[0].date, '2026-03-11');

  const other = await report(admin, 'sales', `${RANGE}&cashier=${otherUser._id}`);
  assert.equal(other.totals.bills, 1);
  assert.equal(other.totals.subtotal, 7000);
});

test('categories: derived from bill rounds, voided skipped, totals equal invoice subtotals', async () => {
  const drinks = await Category.create({ name: 'Drinks' });
  const food = await Category.create({ name: 'Food' });
  const tea = await MenuItem.create({ name: 'Tea', categoryId: drinks._id, price: 2000 });
  const dosa = await MenuItem.create({ name: 'Dosa', categoryId: food._id, price: 8000 });
  const orphan = await MenuItem.create({ name: 'Old', categoryId: oid(), price: 1000 });
  const line = (mi, qty, extra = {}) => ({
    menuItemId: mi._id,
    name: mi.name,
    price: mi.price,
    qty,
    lineTotal: mi.price * qty,
    ...extra,
  });
  const bill = await RunningBill.create({
    billNumber: 'RB-CAT',
    customerId: oid(),
    customerMobile: '9876543210',
    tableId: oid(),
    tableNumber: 'T9',
    status: 'paid',
    rounds: [
      {
        orderNumber: 'ORD-1',
        waiterId: oid(),
        waiterName: 'w',
        idempotencyKey: 'cat-r1',
        items: [line(tea, 2), line(dosa, 1), line(dosa, 3, { isVoided: true })],
      },
      {
        orderNumber: 'ORD-2',
        waiterId: oid(),
        waiterName: 'w',
        idempotencyKey: 'cat-r2',
        items: [line(orphan, 1)],
      },
    ],
  });
  await makeInvoice({
    createdAt: new Date('2025-06-01T12:00:00+05:30'),
    subtotal: 13000,
    billId: bill._id,
  });

  const d = await report(admin, 'categories', 'from=2025-06-01&to=2025-06-01');
  assert.deepEqual(d.rows, [
    { category: 'Food', qty: 1, amount: 8000 },
    { category: 'Drinks', qty: 2, amount: 4000 },
    { category: 'Uncategorised', qty: 1, amount: 1000 },
  ]);
  assert.equal(d.totals.amount, 13000); // == invoice subtotal

  const f = await report(
    admin,
    'categories',
    `from=2025-06-01&to=2025-06-01&category=${drinks._id}`,
  );
  assert.deepEqual(f.rows, [{ category: 'Drinks', qty: 2, amount: 4000 }]);
});

test('cashier: forced to own invoices today, params ignored', async () => {
  const now = new Date();
  await makeInvoice({ createdAt: now, subtotal: 3000 });
  await makeInvoice({ createdAt: now, subtotal: 4000, cashierId: otherUser._id });

  const d = await report(cashier, 'sales', `${RANGE}&cashier=${otherUser._id}`);
  assert.equal(d.from, todayIST());
  assert.equal(d.to, todayIST());
  assert.equal(d.totals.bills, 1);
  assert.equal(d.totals.subtotal, 3000);

  const all = await report(admin, 'sales', `from=${todayIST()}`);
  assert.equal(all.totals.bills, 2);
});

test('validation and roles', async () => {
  assert.equal((await waiter('GET', '/reports/sales')).status, 403);
  assert.equal((await fetch(`${ctx.base}/reports/sales`)).status, 401);
  for (const qs of [
    'type=x',
    'from=2026-03-12&to=2026-03-10',
    'from=2025-01-01&to=2026-03-01',
    'from=2026-02-31',
    'from=12-03-2026',
    'method=bitcoin',
    'cashier=bad',
  ]) {
    const type = qs.startsWith('type=') ? 'nope' : 'sales';
    assert.equal((await admin('GET', `/reports/${type}?${qs}`)).status, 422, qs);
  }
  // Exactly 366 days is allowed.
  assert.equal((await admin('GET', '/reports/sales?from=2025-03-01&to=2026-03-01')).status, 200);
});

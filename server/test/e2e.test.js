// S6-1 cross-feature regression: one restaurant, driven through the real HTTP API the way staff use it
// (docs/web-flow.md, requirement.md §7 + §11). Tests run in order and share state; each scenario uses its
// own customers and records which tables it leaves busy.
//   MONGODB_URI_TEST=mongodb://127.0.0.1:27017/pamaa_test_e2e node --test test/e2e.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { start, makeUser, client } from './setup.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { RunningBill } from '../src/models/RunningBill.js';
import { financialYear } from '../src/services/counters.js';
import { todayIST } from '../src/routes/reports.js';

const FY = financialYear();
const TODAY = todayIST();
const SETTINGS = {
  name: 'PAMAA',
  address: 'MG Road, Bengaluru',
  phone: '9800000000',
  gstin: '29abcde1234f1z5',
  gstRate: 5,
  pricesIncludeTax: false,
  invoicePrefix: 'inv',
  invoiceStartNumber: 1,
  invoiceFooter: 'Thank you',
  printFormat: '80mm',
};

let ctx, admin, waiter, waiter2, cashier, cashierId;
const menu = {}; // name → menu item (from the API)
const tables = {}; // 'T1' → table
let docsInvoice; // the §11 invoice, reused by later scenarios

before(async () => {
  ctx = await start();
  await makeUser({ username: 'owner', role: 'admin' }); // bootstrap admin (seed script in prod)
  admin = await client(ctx.base, 'owner');
});
after(() => ctx.stop());

// ---------- helpers ----------
const ok = (r, status = 200) => {
  assert.equal(r.status, status, `${r.status}: ${r.json.message}`);
  return r.json.data;
};
const line = (name, qty, addOn, instructions) => ({
  menuItemId: menu[name]._id,
  qty,
  addOnIds: addOn ? [menu[name].addOns.find((a) => a.name === addOn)._id] : [],
  ...(instructions && { instructions }),
});
const newCustomer = async (mobile, name) =>
  ok(await waiter('POST', '/customers', name ? { mobile, name } : { mobile }), 201);
const order = (who, { customer, table, billId = null, items, key = randomUUID() }) =>
  who('POST', '/bills/orders', {
    customerId: customer._id,
    ...(table && { tableId: tables[table]._id }),
    billId,
    items,
    idempotencyKey: key,
  });
const tableStatus = async (n) => {
  const t = ok(await waiter('GET', '/tables')).find((x) => x.tableNumber === n);
  return { status: t.status, currentBillId: t.currentBillId && String(t.currentBillId) };
};
const getBill = async (id) => ok(await admin('GET', `/bills/${id}`));
/** Checkout as cashier and pay the full grand total in cash. */
async function settle(billId, { who = cashier, discount = null, payments } = {}) {
  ok(await who('POST', `/bills/${billId}/checkout`));
  const calc = ok(await who('POST', `/bills/${billId}/calculate`, { discount }));
  return ok(
    await who('POST', `/bills/${billId}/invoice`, {
      discount,
      payments: payments ?? [{ method: 'cash', amount: calc.grandTotal }],
      idempotencyKey: randomUUID(),
    }),
    201,
  );
}
async function rawLogin(username, password = 'secret123') {
  const r = await fetch(ctx.base + '/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const json = await r.json();
  return {
    status: r.status,
    token: json.data?.accessToken,
    cookie: r.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; '),
  };
}
const refresh = (cookie) =>
  fetch(ctx.base + '/auth/refresh', { method: 'POST', headers: { cookie } });
const me = (token) =>
  fetch(ctx.base + '/auth/me', { headers: { authorization: `Bearer ${token}` } });
const sumBy = (xs, f) => xs.reduce((s, x) => s + (f(x) ?? 0), 0);

/** All of today's invoices (full documents) as admin. */
async function todaysInvoices() {
  const list = ok(await admin('GET', `/invoices?from=${TODAY}&to=${TODAY}&limit=200`));
  return Promise.all(list.map(async (i) => ok(await admin('GET', `/invoices/${i._id}`))));
}
/** Every report's totals must equal the sums of the same invoices (sprint 5 acceptance). */
async function assertReportsReconcile() {
  const inv = await todaysInvoices();
  const report = async (type) =>
    ok(await admin('GET', `/reports/${type}?from=${TODAY}&to=${TODAY}`));
  const sales = await report('sales');
  assert.deepEqual(sales.totals, {
    bills: inv.length,
    subtotal: sumBy(inv, (i) => i.subtotal),
    discount: sumBy(inv, (i) => i.discount?.amount),
    taxable: sumBy(inv, (i) => i.taxableAmount),
    cgst: sumBy(inv, (i) => i.cgst),
    sgst: sumBy(inv, (i) => i.sgst),
    roundOff: sumBy(inv, (i) => i.roundOff),
    grandTotal: sumBy(inv, (i) => i.grandTotal),
  });
  const pays = inv.flatMap((i) => i.payments);
  const payments = await report('payments');
  assert.equal(
    payments.totals.amount,
    sumBy(pays, (p) => p.amount),
  );
  for (const m of ['cash', 'upi', 'card']) {
    const row = payments.rows.find((r) => r.method === m);
    assert.equal(
      row?.amount ?? 0,
      sumBy(
        pays.filter((p) => p.method === m),
        (p) => p.amount,
      ),
      m,
    );
  }
  const items = await report('items');
  const lines = inv.flatMap((i) => i.items);
  assert.deepEqual(items.totals, {
    qty: sumBy(lines, (l) => l.qty),
    amount: sumBy(lines, (l) => l.amount),
  });
  const categories = await report('categories');
  assert.equal(categories.totals.amount, sales.totals.subtotal);
  const gst = await report('gst');
  assert.deepEqual(gst.totals, {
    taxable: sales.totals.taxable,
    cgst: sales.totals.cgst,
    sgst: sales.totals.sgst,
    tax: sales.totals.cgst + sales.totals.sgst,
  });
  const discounts = await report('discounts');
  assert.equal(discounts.totals.amount, sales.totals.discount);
  assert.equal(discounts.totals.count, inv.filter((i) => i.discount?.amount > 0).length);
  const dash = ok(await admin('GET', '/dashboard/summary'));
  assert.equal(dash.sales, sales.totals.grandTotal);
  assert.equal(dash.billCount, inv.length);
  return { inv, sales, payments, items, categories, gst, discounts, dash };
}

// ---------- scenarios ----------

test('1. admin sets up the restaurant', async () => {
  const s = ok(await admin('PUT', '/settings', SETTINGS));
  assert.equal(s.invoicePrefix, 'INV');
  assert.equal(s.gstin, '29ABCDE1234F1Z5');

  const cats = {};
  for (const name of ['Breakfast', 'Lunch', 'Beverages'])
    cats[name] = ok(await admin('POST', '/categories', { name }), 201);
  assert.equal((await admin('POST', '/categories', { name: 'breakfast' })).status, 409);

  const items = [
    ['Masala Dosa', 'Breakfast', 8000],
    ['Paneer Dosa', 'Breakfast', 12000, [{ name: 'Extra cheese', price: 2000 }]],
    ['Veg Thali', 'Lunch', 15000, [{ name: 'Ghee', price: 1000 }]],
    ['Coffee', 'Beverages', 3000],
    ['Tea', 'Beverages', 2000],
    ['Lassi', 'Beverages', 6100],
  ];
  for (const [name, cat, price, addOns] of items)
    menu[name] = ok(
      await admin('POST', '/menu-items', { name, categoryId: cats[cat]._id, price, addOns }),
      201,
    );

  for (const n of [1, 2, 3, 4, 5])
    tables[`T${n}`] = ok(
      await admin('POST', '/tables', { tableNumber: `T${n}`, capacity: 4 }),
      201,
    );
  assert.equal((await admin('POST', '/tables', { tableNumber: 't5', capacity: 2 })).status, 409);

  const user = (username, role, maxDiscountPercent) =>
    admin('POST', '/users', {
      name: username,
      username,
      password: 'secret123',
      role,
      maxDiscountPercent,
    });
  ok(await user('waiter1', 'waiter'), 201);
  ok(await user('waiter2', 'waiter'), 201);
  cashierId = ok(await user('cashier1', 'cashier', 10), 201)._id;
  [waiter, waiter2, cashier] = await Promise.all(
    ['waiter1', 'waiter2', 'cashier1'].map((u) => client(ctx.base, u)),
  );

  // Floor staff see the same live menu and tables.
  assert.equal(ok(await waiter('GET', '/menu-items?available=true')).length, 6);
  assert.equal(ok(await waiter('GET', '/categories')).length, 3);
  assert.deepEqual(
    ok(await cashier('GET', '/tables')).map((t) => [t.tableNumber, t.status]),
    [1, 2, 3, 4, 5].map((n) => [`T${n}`, 'available']),
  );
});

test('2. docs §11 walkthrough: Ravi at T5, three rounds, discount, split payment', async () => {
  const MOBILE = '9876543210';
  // 7:45 — lookup, not found → quick register.
  const lookup0 = ok(await waiter('GET', `/customers?mobile=${MOBILE}`));
  assert.equal(lookup0.customer, null);
  const ravi = await newCustomer(MOBILE, 'Ravi');

  const r1 = ok(
    await order(waiter, { customer: ravi, table: 'T5', items: [line('Masala Dosa', 2)] }),
    201,
  );
  const billId = r1.bill._id;
  assert.match(r1.bill.billNumber, /^RB-\d{4}$/);
  assert.equal(r1.bill.subtotal, 16000);
  assert.deepEqual(await tableStatus('T5'), { status: 'occupied', currentBillId: billId });

  // 8:05 — lookup shows the active bill → "Add to this bill".
  const lookup = ok(await waiter('GET', `/customers?mobile=${MOBILE}`));
  assert.equal(lookup.customer.name, 'Ravi');
  assert.equal(String(lookup.activeBill._id), billId);
  assert.equal(lookup.activeBill.tableNumber, 'T5');
  const r2 = ok(
    await order(waiter, {
      customer: ravi,
      billId: lookup.activeBill._id,
      items: [line('Coffee', 3)],
    }),
    201,
  );
  assert.equal(r2.bill.subtotal, 25000);

  // 8:20 — Paneer Dosa + extra cheese.
  const r3 = ok(
    await order(waiter, {
      customer: ravi,
      billId,
      items: [line('Paneer Dosa', 1, 'Extra cheese', 'Less spicy')],
    }),
    201,
  );
  const bill = r3.bill;
  assert.equal(bill.rounds.length, 3);
  assert.equal(new Set(bill.rounds.map((r) => r.orderNumber)).size, 3);
  assert.equal(bill.subtotal, 39000);
  assert.equal(bill.rounds[2].items[0].lineTotal, 14000);
  assert.equal(bill.rounds[2].items[0].instructions, 'Less spicy');
  assert.deepEqual(await tableStatus('T5'), { status: 'occupied', currentBillId: billId });
  // Waiter's "My Orders" shows it.
  const mine = ok(await waiter('GET', '/bills'));
  assert.ok(mine.some((b) => b._id === billId && b.roundCount === 3 && b.subtotal === 39000));

  // 8:40 — cashier finds it by mobile, table and bill number (list fields the search box filters on).
  const running = ok(await cashier('GET', '/bills'));
  for (const [field, value] of [
    ['customerMobile', MOBILE],
    ['tableNumber', 'T5'],
    ['billNumber', bill.billNumber],
  ]) {
    const hits = running.filter((b) => b[field] === value);
    assert.deepEqual(
      hits.map((b) => b._id),
      [billId],
      field,
    );
  }
  const byTable = ok(await cashier('GET', `/bills/active-by-table/${tables.T5._id}`));
  assert.equal(String(byTable._id), billId);

  const co = ok(await cashier('POST', `/bills/${billId}/checkout`));
  assert.equal(co.calc.subtotal, 39000);
  assert.equal(co.calc.grandTotal, 41000); // 409.50 rounds half-up
  assert.equal((await tableStatus('T5')).status, 'billing');
  // Bill is being settled: waiter can't add a round.
  const blocked = await order(waiter, { customer: ravi, billId, items: [line('Tea', 1)] });
  assert.equal(blocked.status, 409, blocked.json.message);
  assert.equal((await getBill(billId)).subtotal, 39000);

  // Discount above the cashier's 10% is refused server-side.
  const tenPct = { type: 'percent', value: 10 };
  assert.equal(
    (
      await cashier('POST', `/bills/${billId}/calculate`, {
        discount: { type: 'percent', value: 15 },
      })
    ).status,
    403,
  );
  const calc = ok(await cashier('POST', `/bills/${billId}/calculate`, { discount: tenPct }));
  assert.deepEqual(
    [
      calc.discount.amount,
      calc.taxableAmount,
      calc.cgst,
      calc.sgst,
      calc.roundOff,
      calc.grandTotal,
    ],
    [3900, 35100, 878, 878, 44, 36900],
  );
  const over = await cashier('POST', `/bills/${billId}/invoice`, {
    discount: { type: 'percent', value: 15 },
    payments: [{ method: 'cash', amount: 35500 }],
    idempotencyKey: randomUUID(),
  });
  assert.equal(over.status, 403);

  // 8:41 — cash ₹300 + UPI ₹69.
  docsInvoice = ok(
    await cashier('POST', `/bills/${billId}/invoice`, {
      discount: tenPct,
      payments: [
        { method: 'cash', amount: 30000 },
        { method: 'upi', amount: 6900, reference: 'UPI123456' },
      ],
      idempotencyKey: randomUUID(),
    }),
    201,
  );
  assert.equal(docsInvoice.invoiceNumber, `INV/${FY}/00001`);
  assert.deepEqual(
    [docsInvoice.subtotal, docsInvoice.discount.amount, docsInvoice.taxableAmount],
    [39000, 3900, 35100],
  );
  assert.deepEqual(
    [docsInvoice.cgst, docsInvoice.sgst, docsInvoice.roundOff, docsInvoice.grandTotal],
    [878, 878, 44, 36900],
  );
  assert.deepEqual(
    docsInvoice.items.map((i) => [i.name, i.qty, i.rate, i.amount]),
    [
      ['Masala Dosa', 2, 8000, 16000],
      ['Coffee', 3, 3000, 9000],
      ['Paneer Dosa', 1, 14000, 14000],
    ],
  );
  assert.equal(docsInvoice.restaurant.gstin, '29ABCDE1234F1Z5');
  assert.equal(docsInvoice.customer.mobile, MOBILE);
  assert.equal(docsInvoice.tableNumber, 'T5');

  // After payment.
  assert.deepEqual(await tableStatus('T5'), { status: 'available', currentBillId: null });
  const paid = await getBill(billId);
  assert.equal(paid.status, 'paid');
  assert.equal(String(paid.invoiceId), docsInvoice._id);
  assert.ok(!ok(await cashier('GET', '/bills')).some((b) => b._id === billId));
  const history = ok(await cashier('GET', '/invoices'));
  assert.equal(history[0]._id, docsInvoice._id);
  assert.deepEqual(
    ok(await cashier('GET', `/invoices?q=${MOBILE}`)).map((i) => i._id),
    [docsInvoice._id],
  );
  assert.deepEqual(
    ok(await cashier('GET', '/invoices?table=t5')).map((i) => i._id),
    [docsInvoice._id],
  );
  const profile = ok(await waiter('GET', `/customers/${ravi._id}/history`));
  assert.equal(profile.customer.totalVisits, 1);
  assert.equal(profile.customer.totalSpent, 36900);
  assert.equal(profile.activeBill, null);
  assert.deepEqual(
    profile.invoices.map((i) => i._id),
    [docsInvoice._id],
  );
  assert.equal(ok(await waiter('GET', `/customers?mobile=${MOBILE}`)).activeBill, null);

  // Dashboard (admin + own-shift cashier) and every report agree with the invoice.
  for (const who of [admin, cashier]) {
    const dash = ok(await who('GET', '/dashboard/summary'));
    assert.equal(dash.sales, 36900);
    assert.equal(dash.billCount, 1);
    assert.deepEqual(dash.paymentSplit, { cash: 30000, upi: 6900, card: 0 });
    assert.equal(dash.recentInvoices[0]._id, docsInvoice._id);
    assert.equal(dash.tables.available, 5);
  }
  const rep = await assertReportsReconcile();
  assert.equal(rep.sales.totals.grandTotal, 36900);
  assert.deepEqual(
    rep.items.rows.map((r) => [r.name, r.qty, r.amount]),
    [
      ['Masala Dosa', 2, 16000],
      ['Paneer Dosa', 1, 14000],
      ['Coffee', 3, 9000],
    ],
  );
  assert.deepEqual(
    rep.categories.rows.map((r) => [r.category, r.amount]),
    [
      ['Breakfast', 30000],
      ['Beverages', 9000],
    ],
  );
  assert.deepEqual(rep.gst.totals, { taxable: 35100, cgst: 878, sgst: 878, tax: 1756 });
  assert.deepEqual(
    rep.discounts.rows.map((r) => [r.invoiceNumber, r.type, r.value, r.amount, r.cashierName]),
    [[docsInvoice.invoiceNumber, 'percent', 10, 3900, 'cashier1']],
  );
  const cashierSales = ok(await cashier('GET', '/reports/sales?from=2000-01-01&to=2000-01-01'));
  assert.equal(cashierSales.totals.grandTotal, 36900); // own shift = today, whatever is asked
});

test('3. new customer without a name orders → table turns occupied', async () => {
  const c = await newCustomer('9100000003');
  assert.ok(!c.name);
  const r = ok(await order(waiter, { customer: c, table: 'T1', items: [line('Tea', 2)] }), 201);
  assert.equal(r.bill.customerName, '');
  assert.deepEqual(await tableStatus('T1'), { status: 'occupied', currentBillId: r.bill._id });
  // Occupied table can't be given to someone else.
  const other = await newCustomer('9100000033', 'Other');
  const taken = await order(waiter2, { customer: other, table: 'T1', items: [line('Tea', 1)] });
  assert.equal(taken.status, 409);
  assert.match(taken.json.message, /T1 was just taken/);
  // Same customer can't open a second table either.
  const second = await order(waiter, { customer: c, table: 'T4', items: [line('Tea', 1)] });
  assert.equal(second.status, 409);
  assert.equal((await tableStatus('T4')).status, 'available');
  // T1 stays occupied for the rest of the suite (an open bill on the dashboard).
});

let raceBillId; // T2, settled in scenario 5
test('4. two waiters race for the same free table → one wins, no orphan, table not stuck', async () => {
  const [a, b] = await Promise.all([
    newCustomer('9100000041', 'A'),
    newCustomer('9100000042', 'B'),
  ]);
  const results = await Promise.all([
    order(waiter, { customer: a, table: 'T2', items: [line('Masala Dosa', 1)] }),
    order(waiter2, { customer: b, table: 'T2', items: [line('Coffee', 1)] }),
  ]);
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 409], results.map((r) => r.json.message).join(' | '));
  const winner = results.find((r) => r.status === 201).json.data.bill;
  const loser = winner.customerId === a._id ? b : a;
  raceBillId = winner._id;

  assert.deepEqual(await tableStatus('T2'), { status: 'occupied', currentBillId: winner._id });
  const active = await RunningBill.find({
    tableId: tables.T2._id,
    status: { $in: ['open', 'billing'] },
  });
  assert.equal(active.length, 1);
  assert.equal(await RunningBill.countDocuments({ customerId: loser._id }), 0);
  assert.equal(ok(await waiter('GET', `/customers?mobile=${loser.mobile}`)).activeBill, null);
  // Loser goes back to the grid and picks another table.
  const retry = ok(
    await order(waiter2, { customer: loser, table: 'T3', items: [line('Tea', 1)] }),
    201,
  );
  // Free T3 again for later scenarios.
  await settle(retry.bill._id);
  assert.equal((await tableStatus('T3')).status, 'available');
});

test('5. double-submitted invoice → exactly one invoice; reprint increments printCount', async () => {
  ok(await cashier('POST', `/bills/${raceBillId}/checkout`));
  const calc = ok(await cashier('POST', `/bills/${raceBillId}/calculate`, {}));
  const body = {
    payments: [{ method: 'cash', amount: calc.grandTotal }],
    idempotencyKey: randomUUID(),
  };
  // Same request twice at once (double click / network retry with the same key).
  const same = await Promise.all(
    [1, 2].map(() => cashier('POST', `/bills/${raceBillId}/invoice`, body)),
  );
  for (const r of same) assert.ok([200, 201].includes(r.status), `${r.status}: ${r.json.message}`);
  assert.equal(same.filter((r) => r.status === 201).length, 1);
  assert.equal(same[0].json.data._id, same[1].json.data._id);
  // A different key for an invoiced bill is refused.
  const again = await cashier('POST', `/bills/${raceBillId}/invoice`, {
    ...body,
    idempotencyKey: randomUUID(),
  });
  assert.equal(again.status, 409);

  const inv = ok(await admin('GET', `/invoices?table=T2`)).filter(
    (i) => i.billNumber === same[0].json.data.billNumber,
  );
  assert.equal(inv.length, 1);
  assert.equal((await tableStatus('T2')).status, 'available');

  const id = inv[0]._id;
  assert.equal(ok(await admin('GET', `/invoices/${id}`)).printCount, 0);
  assert.equal(ok(await cashier('POST', `/invoices/${id}/reprint`)).printCount, 1);
  assert.equal(ok(await cashier('POST', `/invoices/${id}/reprint`)).printCount, 2);
  assert.equal(ok(await admin('GET', `/invoices/${id}`)).printCount, 2);

  // Concurrent double click where the client sent two different keys: still exactly one invoice.
  const c = await newCustomer('9100000051', 'Dbl');
  const b = ok(
    await order(waiter, { customer: c, table: 'T2', items: [line('Tea', 1)] }),
    201,
  ).bill;
  ok(await cashier('POST', `/bills/${b._id}/checkout`));
  const pay = [{ method: 'cash', amount: 2100 }];
  const two = await Promise.all(
    [1, 2].map(() =>
      cashier('POST', `/bills/${b._id}/invoice`, { payments: pay, idempotencyKey: randomUUID() }),
    ),
  );
  assert.deepEqual(
    two.map((r) => r.status).sort(),
    [201, 409],
    two.map((r) => r.json.message).join(' | '),
  );
  assert.equal(ok(await admin('GET', `/customers/${c._id}`)).totalVisits, 1);
  assert.equal((await tableStatus('T2')).status, 'available');
});

test('6. split payment ₹500 cash + ₹740 UPI accepted only when it equals the grand total', async () => {
  const c = await newCustomer('9100000061', 'Split');
  // 4 Thali 600 + 2 Paneer+cheese 280 + 3 Masala Dosa 240 + Lassi 61 = ₹1,181 → ₹1,240.05 → ₹1,240
  const b = ok(
    await order(waiter, {
      customer: c,
      table: 'T3',
      items: [
        line('Veg Thali', 4),
        line('Paneer Dosa', 2, 'Extra cheese'),
        line('Masala Dosa', 3),
        line('Lassi', 1),
      ],
    }),
    201,
  ).bill;
  assert.equal(b.subtotal, 118100);
  const co = ok(await cashier('POST', `/bills/${b._id}/checkout`));
  assert.equal(co.calc.grandTotal, 124000);
  const pay = (cash, upi) =>
    cashier('POST', `/bills/${b._id}/invoice`, {
      payments: [
        { method: 'cash', amount: cash, tendered: 50000 },
        { method: 'upi', amount: upi, reference: 'UPI-SPLIT' },
      ],
      idempotencyKey: randomUUID(),
    });
  for (const upi of [73900, 74100]) {
    const r = await pay(50000, upi);
    assert.equal(r.status, 422, r.json.message);
  }
  assert.equal((await getBill(b._id)).status, 'billing');
  assert.equal((await tableStatus('T3')).status, 'billing');
  const inv = ok(await pay(50000, 74000), 201);
  assert.equal(inv.grandTotal, 124000);
  assert.deepEqual(
    inv.payments.map((p) => [p.method, p.amount]),
    [
      ['cash', 50000],
      ['upi', 74000],
    ],
  );
  assert.equal((await tableStatus('T3')).status, 'available');
});

test('7. price change / soft delete never alter an open bill or a past invoice', async () => {
  const c = await newCustomer('9100000071', 'Price');
  const b1 = ok(
    await order(waiter, { customer: c, table: 'T4', items: [line('Lassi', 2)] }),
    201,
  ).bill;
  assert.equal(b1.subtotal, 12200);

  ok(await admin('PATCH', `/menu-items/${menu.Lassi._id}`, { price: 7000 }));
  assert.equal((await getBill(b1._id)).subtotal, 12200); // saved round unchanged
  const b2 = ok(
    await order(waiter, { customer: c, billId: b1._id, items: [line('Lassi', 1)] }),
    201,
  ).bill;
  assert.equal(b2.subtotal, 12200 + 7000); // new round at the new price
  assert.deepEqual(
    b2.rounds.map((r) => r.items[0].price),
    [6100, 7000],
  );

  const inv = await settle(b1._id, { who: admin });
  assert.deepEqual(
    inv.items.map((i) => [i.name, i.qty, i.rate]),
    [
      ['Lassi', 2, 6100],
      ['Lassi', 1, 7000],
    ],
  );

  // After the fact: price changes again and the item is soft-deleted.
  ok(await admin('PATCH', `/menu-items/${menu.Lassi._id}`, { price: 9900 }));
  ok(await admin('DELETE', `/menu-items/${menu.Lassi._id}`));
  assert.ok(!ok(await waiter('GET', '/menu-items')).some((m) => m.name === 'Lassi'));
  const again = ok(await admin('GET', `/invoices/${inv._id}`));
  assert.deepEqual(again.items, inv.items);
  assert.equal(again.grandTotal, inv.grandTotal);
  const docs = ok(await admin('GET', `/invoices/${docsInvoice._id}`));
  assert.equal(docs.grandTotal, 36900);
  // Category report still attributes the deleted item to its category.
  const cats = ok(await admin('GET', `/reports/categories?from=${TODAY}&to=${TODAY}`));
  assert.ok(cats.rows.some((r) => r.category === 'Beverages'));
  assert.ok(!cats.rows.some((r) => r.category === 'Uncategorised'));
  // Deleted item can't be ordered.
  const c2 = await newCustomer('9100000072');
  const r = await order(waiter, { customer: c2, table: 'T4', items: [line('Lassi', 1)] });
  assert.equal(r.status, 422);
  assert.equal((await tableStatus('T4')).status, 'available');
});

test('8. admin voids items and cancels the emptied bill → table released, new bill possible', async () => {
  const c = await newCustomer('9100000081', 'Void');
  const b = ok(
    await order(waiter, {
      customer: c,
      table: 'T2',
      items: [line('Coffee', 2), line('Masala Dosa', 1)],
    }),
    201,
  ).bill;
  assert.equal(b.subtotal, 14000);
  const [coffee, dosa] = b.rounds[0].items;

  const reason = { reason: 'Customer changed mind' };
  assert.equal(
    (await waiter('PATCH', `/bills/${b._id}/items/${coffee._id}/void`, reason)).status,
    403,
  );
  assert.equal(
    (await cashier('PATCH', `/bills/${b._id}/items/${coffee._id}/void`, reason)).status,
    403,
  );
  assert.equal((await admin('PATCH', `/bills/${b._id}/items/${coffee._id}/void`, {})).status, 422);
  const v1 = ok(await admin('PATCH', `/bills/${b._id}/items/${coffee._id}/void`, reason));
  assert.equal(v1.subtotal, 8000);
  assert.equal(
    (await admin('PATCH', `/bills/${b._id}/items/${coffee._id}/void`, reason)).status,
    409,
  );
  const log = await AuditLog.findOne({ action: 'bill.voidItem', entityId: b._id }).lean();
  assert.ok(log, 'void is audited');
  assert.equal(log.details.reason, reason.reason);
  assert.equal(log.details.lineTotal, 6000);

  assert.equal((await admin('POST', `/bills/${b._id}/cancel`, reason)).status, 409); // still has a live item
  ok(await admin('PATCH', `/bills/${b._id}/items/${dosa._id}/void`, reason));
  assert.equal((await getBill(b._id)).subtotal, 0);
  assert.equal((await waiter('POST', `/bills/${b._id}/cancel`, reason)).status, 403);
  const cancelled = ok(await admin('POST', `/bills/${b._id}/cancel`, { reason: 'Walk-out' }));
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(await tableStatus('T2'), { status: 'available', currentBillId: null });
  assert.ok(await AuditLog.exists({ action: 'bill.cancel', entityId: b._id }));
  assert.ok(!ok(await cashier('GET', '/bills')).some((x) => x._id === b._id));

  // Bill kept (never hard-deleted), customer and table are free for a new bill.
  assert.equal((await getBill(b._id)).status, 'cancelled');
  const nb = ok(
    await order(waiter, { customer: c, table: 'T2', items: [line('Tea', 1)] }),
    201,
  ).bill;
  assert.notEqual(nb._id, b._id);
  await settle(nb._id);
  assert.equal(ok(await admin('GET', `/customers/${c._id}`)).totalVisits, 1);
});

test('9. cancel checkout → bill open, table occupied, waiter can add a round', async () => {
  const c = await newCustomer('9100000091', 'Undo');
  const b = ok(
    await order(waiter, { customer: c, table: 'T3', items: [line('Coffee', 1)] }),
    201,
  ).bill;
  ok(await cashier('POST', `/bills/${b._id}/checkout`));
  assert.equal(
    (await order(waiter, { customer: c, billId: b._id, items: [line('Tea', 1)] })).status,
    409,
  );
  assert.equal((await waiter('POST', `/bills/${b._id}/cancel-checkout`)).status, 403);

  const back = ok(await cashier('POST', `/bills/${b._id}/cancel-checkout`));
  assert.equal(back.status, 'open');
  assert.deepEqual(await tableStatus('T3'), { status: 'occupied', currentBillId: b._id });
  assert.equal(
    (
      await cashier('POST', `/bills/${b._id}/invoice`, {
        payments: [{ method: 'cash', amount: 3200 }],
        idempotencyKey: randomUUID(),
      })
    ).status,
    409,
  ); // not at checkout any more
  const more = ok(
    await order(waiter, { customer: c, billId: b._id, items: [line('Tea', 1)] }),
    201,
  );
  assert.equal(more.bill.rounds.length, 2);
  assert.equal(more.bill.subtotal, 5000);
  const inv = await settle(b._id);
  assert.equal(inv.subtotal, 5000);
  assert.equal(inv.grandTotal, 5300); // 52.50 → 53
});

test('10. role lockout via direct API + deactivated user loses token and refresh', async () => {
  const anyBill = ok(await admin('GET', '/bills?status=paid'))[0]._id;
  const forbidden = [
    ['POST', `/bills/${anyBill}/checkout`],
    ['POST', `/bills/${anyBill}/cancel-checkout`],
    ['POST', `/bills/${anyBill}/calculate`, {}],
    ['POST', `/bills/${anyBill}/invoice`, { payments: [], idempotencyKey: randomUUID() }],
    ['POST', `/bills/${anyBill}/cancel`, { reason: 'nope nope' }],
    ['GET', '/invoices'],
    ['GET', `/invoices/${docsInvoice._id}`],
    ['POST', `/invoices/${docsInvoice._id}/reprint`],
    ['GET', '/dashboard/summary'],
    ...['sales', 'payments', 'items', 'categories', 'discounts', 'gst'].map((t) => [
      'GET',
      `/reports/${t}`,
    ]),
    ['POST', '/menu-items', { name: 'Hack', categoryId: menu.Tea.categoryId, price: 1 }],
    ['PATCH', `/menu-items/${menu.Tea._id}`, { price: 1 }],
    ['DELETE', `/menu-items/${menu.Tea._id}`],
    ['POST', '/categories', { name: 'Hack' }],
    ['POST', '/tables', { tableNumber: 'T99', capacity: 2 }],
    ['GET', '/users'],
    ['POST', '/users', { name: 'x', username: 'hacker', password: 'secret123', role: 'admin' }],
    ['PATCH', `/users/${cashierId}`, { maxDiscountPercent: 100 }],
    ['PUT', '/settings', { ...SETTINGS, gstRate: 0 }],
  ];
  for (const [m, p, body] of forbidden) {
    const r = await waiter(m, p, body);
    assert.equal(r.status, 403, `waiter ${m} ${p} → ${r.status}`);
  }
  // Cashier can bill but not edit the menu, users or settings.
  for (const [m, p, body] of forbidden.filter(([, p]) =>
    /^\/(menu-items|categories|tables|users|settings)/.test(p),
  )) {
    const r = await cashier(m, p, body);
    assert.equal(r.status, 403, `cashier ${m} ${p} → ${r.status}`);
  }
  assert.equal(ok(await admin('GET', `/menu-items/${menu.Tea._id}`)).price, 2000);
  assert.equal(ok(await admin('GET', '/settings')).gstRate, 5);
  // Waiter's bill list is limited to their own rounds.
  const wb = ok(await waiter2('GET', '/bills'));
  assert.ok(wb.every((b) => b.billNumber)); // shape only
  assert.ok(!wb.some((b) => b.tableNumber === 'T1')); // T1's open bill belongs to waiter1

  // Deactivation.
  ok(
    await admin('POST', '/users', {
      name: 'Temp',
      username: 'temp.waiter',
      password: 'secret123',
      role: 'waiter',
    }),
    201,
  );
  const s = await rawLogin('temp.waiter');
  assert.equal(s.status, 200);
  assert.equal((await me(s.token)).status, 200);
  const r1 = await refresh(s.cookie);
  assert.equal(r1.status, 200);
  const cookie = r1.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const tempId = ok(await admin('GET', '/users?q=temp.waiter'))[0]._id;
  ok(await admin('PATCH', `/users/${tempId}`, { isActive: false }));
  assert.equal((await me(s.token)).status, 401);
  assert.equal((await refresh(cookie)).status, 401);
  assert.equal((await rawLogin('temp.waiter')).status, 401);
  const c = await newCustomer('9100000101');
  const r = await fetch(ctx.base + '/bills/orders', {
    method: 'POST',
    headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      customerId: c._id,
      tableId: tables.T4._id,
      billId: null,
      items: [line('Tea', 1)],
      idempotencyKey: randomUUID(),
    }),
  });
  assert.equal(r.status, 401);
  assert.equal((await tableStatus('T4')).status, 'available');
  assert.equal((await admin('PATCH', `/users/${tempId}`, { isActive: true })).status, 200);
  assert.equal((await me(s.token)).status, 401); // deactivation killed the old session for good
  assert.equal((await rawLogin('temp.waiter')).status, 200);
});

test('11. invoice numbers are sequential INV/<FY>/NNNNN and respect invoiceStartNumber', async () => {
  const all = ok(await admin('GET', '/invoices?limit=200'));
  const nums = all.map((i) => i.invoiceNumber).sort();
  assert.ok(
    nums.every((n) => n.startsWith(`INV/${FY}/`)),
    nums.join(),
  );
  assert.deepEqual(
    nums,
    nums.map((_, i) => `INV/${FY}/${String(i + 1).padStart(5, '0')}`),
  );

  ok(await admin('PUT', '/settings', { ...SETTINGS, invoiceStartNumber: 500 }));
  const c1 = await newCustomer('9100000111');
  const b1 = ok(
    await order(waiter, { customer: c1, table: 'T4', items: [line('Tea', 1)] }),
    201,
  ).bill;
  assert.equal((await settle(b1._id)).invoiceNumber, `INV/${FY}/00500`);

  // Lowering it again never reuses numbers.
  ok(await admin('PUT', '/settings', { ...SETTINGS, invoiceStartNumber: 1 }));
  const c2 = await newCustomer('9100000112');
  const b2 = ok(
    await order(waiter, { customer: c2, table: 'T4', items: [line('Coffee', 1)] }),
    201,
  ).bill;
  assert.equal((await settle(b2._id)).invoiceNumber, `INV/${FY}/00501`);
});

test('12. failed saves never leave a table occupied without a bill', async () => {
  const c = await newCustomer('9100000121', 'Fail');
  const free = async () =>
    assert.deepEqual(await tableStatus('T5'), { status: 'available', currentBillId: null });
  const noBill = async () =>
    assert.equal(await RunningBill.countDocuments({ customerId: c._id }), 0);

  // Unavailable item → 422 naming it.
  ok(await admin('PATCH', `/menu-items/${menu.Coffee._id}`, { isAvailable: false }));
  let r = await order(waiter, {
    customer: c,
    table: 'T5',
    items: [line('Tea', 1), line('Coffee', 1)],
  });
  assert.equal(r.status, 422);
  assert.match(r.json.message, /Coffee is no longer available/);
  await free();
  await noBill();
  ok(await admin('PATCH', `/menu-items/${menu.Coffee._id}`, { isAvailable: true }));

  // Unknown add-on (validated after the table is claimed) → rolled back.
  r = await order(waiter, {
    customer: c,
    table: 'T5',
    items: [{ ...line('Tea', 1), addOnIds: [menu['Veg Thali'].addOns[0]._id] }],
  });
  assert.equal(r.status, 422);
  await free();
  await noBill();

  // Bad payload, unknown customer, inactive table.
  r = await order(waiter, { customer: c, table: 'T5', items: [{ ...line('Tea', 1), qty: 0 }] });
  assert.equal(r.status, 422);
  r = await order(waiter, {
    customer: { _id: '0123456789abcdef01234567' },
    table: 'T5',
    items: [line('Tea', 1)],
  });
  assert.equal(r.status, 404);
  await free();

  // Retried confirm (same idempotency key) saves the round once.
  const key = randomUUID();
  const first = ok(
    await order(waiter, { customer: c, table: 'T5', items: [line('Tea', 1)], key }),
    201,
  );
  const retry = ok(
    await order(waiter, { customer: c, table: 'T5', items: [line('Tea', 1)], key }),
    200,
  );
  assert.equal(retry.bill._id, first.bill._id);
  assert.equal((await getBill(first.bill._id)).rounds.length, 1);

  // Failed add-round on an open bill leaves the bill untouched.
  r = await order(waiter, { customer: c, billId: first.bill._id, items: [line('Lassi', 1)] });
  assert.equal(r.status, 422);
  const after = await getBill(first.bill._id);
  assert.equal(after.rounds.length, 1);
  assert.equal(after.subtotal, 2000);
  assert.deepEqual(await tableStatus('T5'), { status: 'occupied', currentBillId: first.bill._id });
  await settle(first.bill._id);
  await free();

  // Ordering onto a paid bill is refused.
  r = await order(waiter, { customer: c, billId: first.bill._id, items: [line('Tea', 1)] });
  assert.equal(r.status, 409);
  await free();
});

test('13. end of day: dashboard, reports and tables reconcile across every scenario', async () => {
  const { inv, dash } = await assertReportsReconcile();
  assert.equal(dash.openBills.count, 1); // scenario 3's T1
  assert.deepEqual(dash.tables, { available: 4, occupied: 1, billing: 0, total: 5 });
  // No table claims a bill that isn't active, and every active bill holds its table.
  const tbl = ok(await admin('GET', '/tables'));
  const active = await RunningBill.find({ status: { $in: ['open', 'billing'] } }).lean();
  for (const t of tbl) {
    const bill = active.find((b) => String(b.tableId) === t._id);
    assert.equal(t.status === 'available', !bill, t.tableNumber);
    assert.equal(
      t.currentBillId ? String(t.currentBillId) : null,
      bill ? String(bill._id) : null,
      t.tableNumber,
    );
  }
  // Customer totals equal their invoices.
  const byCustomer = Object.groupBy(inv, (i) => i.customer.customerId);
  for (const [id, list] of Object.entries(byCustomer)) {
    const cust = ok(await admin('GET', `/customers/${id}`));
    assert.equal(cust.totalVisits, list.length, cust.mobile);
    assert.equal(
      cust.totalSpent,
      sumBy(list, (i) => i.grandTotal),
      cust.mobile,
    );
  }
  // Cashier's own-shift report excludes the admin-billed invoice (scenario 7).
  const mine = ok(await cashier('GET', '/reports/sales'));
  const theirs = inv.filter((i) => i.cashierId === cashierId);
  assert.equal(mine.totals.bills, theirs.length);
  assert.equal(
    mine.totals.grandTotal,
    sumBy(theirs, (i) => i.grandTotal),
  );
  assert.ok(theirs.length < inv.length);
});

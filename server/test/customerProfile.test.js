import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { start, makeUser, client } from './setup.js';
import { Customer } from '../src/models/Customer.js';
import { Invoice } from '../src/models/Invoice.js';
import { RunningBill } from '../src/models/RunningBill.js';

let ctx, admin, waiter, cashierUser;
const oid = () => new mongoose.Types.ObjectId();
const ids = (r) => r.json.data.map((c) => c._id);

let n = 0;
const makeInvoice = (customer, createdAt) => {
  n += 1;
  return Invoice.create({
    invoiceNumber: `INV/2026-27/${String(n).padStart(5, '0')}`,
    billId: oid(),
    billNumber: `B${n}`,
    idempotencyKey: `k${n}`,
    customer: { customerId: customer._id, name: customer.name, mobile: customer.mobile },
    tableNumber: 'T2',
    subtotal: 1000,
    taxableAmount: 1000,
    gstRate: 5,
    cgst: 25,
    sgst: 25,
    roundOff: 0,
    grandTotal: 1050,
    payments: [{ method: 'upi', amount: 1050, reference: 'x' }],
    cashierId: cashierUser._id,
    cashierName: 'cashier',
    createdAt,
  });
};

let asha, ravi, star, never;
before(async () => {
  ctx = await start();
  await makeUser({ username: 'admin', role: 'admin' });
  cashierUser = await makeUser({ username: 'cashier', role: 'cashier' });
  await makeUser({ username: 'waiter', role: 'waiter' });
  [admin, waiter] = await Promise.all([client(ctx.base, 'admin'), client(ctx.base, 'waiter')]);

  never = await Customer.create({ mobile: '9000000001', name: 'Never Visited' });
  asha = await Customer.create({
    mobile: '9876543210',
    name: 'Asha Rao',
    totalVisits: 2,
    lastVisitAt: new Date('2026-03-01'),
  });
  ravi = await Customer.create({
    mobile: '7000054321',
    name: 'Ravi',
    lastVisitAt: new Date('2026-05-01'),
  });
  star = await Customer.create({ mobile: '8000000002', name: 'A.*+ (Star)' });
});
after(() => ctx.stop());

test('search by digits matches mobile substring', async () => {
  const r = await waiter('GET', '/customers/search?q=5432');
  assert.equal(r.status, 200);
  assert.deepEqual(ids(r).sort(), [asha, ravi].map((c) => String(c._id)).sort());
  assert.deepEqual(Object.keys(r.json.data[0]).sort(), [
    '_id',
    'lastVisitAt',
    'mobile',
    'name',
    'totalSpent',
    'totalVisits',
  ]);
});

test('search by name is case-insensitive and escapes regex chars', async () => {
  assert.deepEqual(ids(await waiter('GET', '/customers/search?q=asha')), [String(asha._id)]);
  const special = await waiter('GET', `/customers/search?q=${encodeURIComponent('.*+ (')}`);
  assert.deepEqual(ids(special), [String(star._id)]);
  assert.deepEqual(ids(await waiter('GET', '/customers/search?q=zzz')), []);
});

test('empty q → most recently visited first, never-visited last (newest created first)', async () => {
  const expected = [ravi, asha, star, never].map((c) => String(c._id));
  assert.deepEqual(ids(await waiter('GET', '/customers/search')), expected);
  assert.deepEqual(ids(await waiter('GET', '/customers/search?q=%20')), expected);
});

test('profile: get, 404, malformed id', async () => {
  const r = await waiter('GET', `/customers/${asha._id}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.data.name, 'Asha Rao');
  assert.equal((await admin('GET', `/customers/${oid()}`)).status, 404);
  assert.equal((await admin('GET', `/customers/${oid()}/history`)).status, 404);
  assert.equal((await admin('GET', '/customers/bad')).status, 422);
  assert.equal((await admin('GET', '/customers/bad/history')).status, 422);
});

test('history: active bill + invoices newest first (waiter allowed)', async () => {
  const empty = await waiter('GET', `/customers/${never._id}/history`);
  assert.equal(empty.status, 200);
  assert.equal(empty.json.data.activeBill, null);
  assert.deepEqual(empty.json.data.invoices, []);

  const i1 = await makeInvoice(asha, new Date('2026-01-01'));
  const i2 = await makeInvoice(asha, new Date('2026-03-01'));
  await makeInvoice(ravi);
  const base = { customerId: asha._id, customerMobile: asha.mobile, tableNumber: 'T2' };
  // RunningBill's unique rounds.idempotencyKey index is not sparse, so each bill needs a round with its own key.
  const round = (key) => [
    { orderNumber: key, waiterId: oid(), waiterName: 'w', idempotencyKey: key, items: [] },
  ];
  await RunningBill.create({
    ...base,
    billNumber: 'B-old',
    tableId: oid(),
    status: 'paid',
    rounds: round('r1'),
  });
  const bill = await RunningBill.create({
    ...base,
    billNumber: 'B-live',
    tableId: oid(),
    status: 'billing',
    subtotal: 5000,
    rounds: round('r2'),
  });

  const r = await waiter('GET', `/customers/${asha._id}/history`);
  assert.equal(r.status, 200);
  assert.equal(r.json.data.customer._id, String(asha._id));
  assert.deepEqual(r.json.data.activeBill, {
    _id: String(bill._id),
    billNumber: 'B-live',
    tableNumber: 'T2',
    status: 'billing',
    subtotal: 5000,
  });
  assert.deepEqual(
    r.json.data.invoices.map((i) => i._id),
    [i2, i1].map((i) => String(i._id)),
  );
  assert.deepEqual(r.json.data.invoices[0].payments, [{ method: 'upi', amount: 1050 }]);
  assert.equal(r.json.data.invoices[0].items, undefined);
});

test('unauthenticated → 401', async () => {
  for (const p of ['/customers/search', `/customers/${asha._id}`, `/customers/${asha._id}/history`])
    assert.equal((await fetch(ctx.base + p)).status, 401);
});

test('Sprint 2 GET/POST /customers still work alongside this router', async () => {
  const r = await waiter('GET', `/customers?mobile=${asha.mobile}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.data.customer._id, String(asha._id));
  assert.equal(r.json.data.activeBill.billNumber, 'B-live');
  assert.equal((await waiter('GET', '/customers?mobile=123')).status, 422);
  assert.equal((await waiter('POST', '/customers', { mobile: '9123456789' })).status, 201);
});

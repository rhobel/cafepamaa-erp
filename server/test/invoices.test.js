import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { start, makeUser, client } from './setup.js';
import { Invoice } from '../src/models/Invoice.js';
import { AuditLog } from '../src/models/AuditLog.js';

let ctx, admin, cashier, waiter, cashierUser;
const custA = new mongoose.Types.ObjectId();
const custB = new mongoose.Types.ObjectId();
let n = 0;

const makeInvoice = (customerId, createdAt) => {
  n += 1;
  return Invoice.create({
    invoiceNumber: `INV/2026-27/${String(n).padStart(5, '0')}`,
    billId: new mongoose.Types.ObjectId(),
    billNumber: `B${n}`,
    idempotencyKey: `k${n}`,
    customer: { customerId, name: 'Asha', mobile: '9876543210' },
    tableNumber: 'T1',
    items: [{ name: 'Tea', qty: 1, rate: 2000, amount: 2000 }],
    subtotal: 2000,
    taxableAmount: 2000,
    gstRate: 5,
    cgst: 50,
    sgst: 50,
    roundOff: 0,
    grandTotal: 2100,
    payments: [{ method: 'cash', amount: 2100, tendered: 2500, change: 400 }],
    cashierId: cashierUser._id,
    cashierName: 'cashier',
    createdAt,
  });
};

before(async () => {
  ctx = await start();
  await makeUser({ username: 'admin', role: 'admin' });
  cashierUser = await makeUser({ username: 'cashier', role: 'cashier' });
  await makeUser({ username: 'waiter', role: 'waiter' });
  [admin, cashier, waiter] = await Promise.all(
    ['admin', 'cashier', 'waiter'].map((u) => client(ctx.base, u)),
  );
});
after(() => ctx.stop());

test('get invoice, 404, malformed id', async () => {
  const inv = await makeInvoice(custA);
  const r = await cashier('GET', `/invoices/${inv._id}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.data.invoiceNumber, inv.invoiceNumber);
  assert.equal(r.json.data.items[0].name, 'Tea');
  assert.equal(r.json.data.printCount, 0);

  const missing = new mongoose.Types.ObjectId();
  assert.equal((await admin('GET', `/invoices/${missing}`)).status, 404);
  assert.equal((await admin('POST', `/invoices/${missing}/reprint`)).status, 404);
  assert.equal((await admin('GET', '/invoices/nope')).status, 422);
  assert.equal((await admin('POST', '/invoices/nope/reprint')).status, 422);
});

test('reprint increments printCount and audits each time', async () => {
  const inv = await makeInvoice(custA);
  const r1 = await cashier('POST', `/invoices/${inv._id}/reprint`);
  assert.equal(r1.status, 200);
  assert.equal(r1.json.data.printCount, 1);
  const r2 = await admin('POST', `/invoices/${inv._id}/reprint`);
  assert.equal(r2.json.data.printCount, 2);

  const logs = await AuditLog.find({ action: 'invoice.reprint', entityId: inv._id })
    .sort({ createdAt: 1 })
    .lean();
  assert.equal(logs.length, 2);
  assert.deepEqual(
    logs.map((l) => l.details),
    [
      { invoiceNumber: inv.invoiceNumber, printCount: 1 },
      { invoiceNumber: inv.invoiceNumber, printCount: 2 },
    ],
  );
});

test('waiter → 403, unauthenticated → 401, no edit/delete routes', async () => {
  const inv = await makeInvoice(custA);
  assert.equal((await waiter('GET', '/invoices')).status, 403);
  assert.equal((await waiter('GET', `/invoices/${inv._id}`)).status, 403);
  assert.equal((await waiter('POST', `/invoices/${inv._id}/reprint`)).status, 403);
  assert.equal((await fetch(`${ctx.base}/invoices/${inv._id}`)).status, 401);
  assert.equal((await admin('PATCH', `/invoices/${inv._id}`, { grandTotal: 1 })).status, 404);
  assert.equal((await admin('DELETE', `/invoices/${inv._id}`)).status, 404);
});

test('list: summaries newest first, filter by customer, limit', async () => {
  await Invoice.deleteMany({});
  const old = await makeInvoice(custB, new Date('2026-01-01'));
  const mid = await makeInvoice(custA, new Date('2026-02-01'));
  const latest = await makeInvoice(custB, new Date('2026-03-01'));

  const all = await cashier('GET', '/invoices');
  assert.equal(all.status, 200);
  assert.deepEqual(
    all.json.data.map((i) => i._id),
    [latest, mid, old].map((i) => String(i._id)),
  );
  const s = all.json.data[0];
  assert.deepEqual(Object.keys(s).sort(), [
    '_id',
    'billNumber',
    'cashierName',
    'createdAt',
    'customer',
    'grandTotal',
    'invoiceNumber',
    'payments',
    'tableNumber',
  ]);
  assert.deepEqual(s.payments, [{ method: 'cash', amount: 2100 }]);

  const byB = await cashier('GET', `/invoices?customer=${custB}`);
  assert.deepEqual(
    byB.json.data.map((i) => i._id),
    [latest, old].map((i) => String(i._id)),
  );
  const lim = await cashier('GET', '/invoices?limit=1');
  assert.deepEqual(
    lim.json.data.map((i) => i._id),
    [String(latest._id)],
  );
  for (const q of ['limit=0', 'limit=201', 'limit=x', 'customer=bad'])
    assert.equal((await cashier('GET', `/invoices?${q}`)).status, 422);
});

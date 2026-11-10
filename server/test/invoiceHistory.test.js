import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { start, makeUser, client } from './setup.js';
import { Invoice } from '../src/models/Invoice.js';

let ctx, cashier, waiter, cashierUser, otherUser;
const inv = {};

const make = (
  key,
  { createdAt, mobile = '9000000000', table = 'T1', method = 'cash', cashierId } = {},
) =>
  Invoice.create({
    invoiceNumber: `INV/2026-27/${key}`,
    billId: new mongoose.Types.ObjectId(),
    billNumber: `RB-${key}`,
    idempotencyKey: `h${key}`,
    customer: { customerId: new mongoose.Types.ObjectId(), name: 'A', mobile },
    tableNumber: table,
    items: [{ name: 'Tea', qty: 1, rate: 1000, amount: 1000 }],
    subtotal: 1000,
    taxableAmount: 1000,
    gstRate: 0,
    cgst: 0,
    sgst: 0,
    roundOff: 0,
    grandTotal: method ? 1000 : 0,
    payments: method ? [{ method, amount: 1000 }] : [],
    cashierId: cashierId ?? cashierUser._id,
    cashierName: 'c',
    createdAt,
  }).then((d) => (inv[key] = String(d._id)));

const ids = async (qs) => {
  const r = await cashier('GET', `/invoices?${qs}`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.data.map((i) => i._id);
};

before(async () => {
  ctx = await start();
  cashierUser = await makeUser({ username: 'cashier', role: 'cashier' });
  otherUser = await makeUser({ username: 'cashier2', role: 'cashier' });
  await makeUser({ username: 'waiter', role: 'waiter' });
  [cashier, waiter] = await Promise.all(['cashier', 'waiter'].map((u) => client(ctx.base, u)));

  await make('00001', { createdAt: new Date('2026-03-10T23:30:00+05:30'), mobile: '9876543210' });
  await make('00002', {
    createdAt: new Date('2026-03-11T00:30:00+05:30'),
    table: 'T5',
    method: 'upi',
  });
  await make('00003', {
    createdAt: new Date('2026-03-12T10:00:00+05:30'),
    cashierId: otherUser._id,
    method: 'card',
  });
  await make('00104', { createdAt: new Date('2026-03-13T10:00:00+05:30'), method: null }); // ₹0, no payments
});
after(() => ctx.stop());

test('q by invoice number substring (case-insensitive, regex-safe) and by mobile', async () => {
  assert.deepEqual(await ids('q=0000'), [inv['00003'], inv['00002'], inv['00001']]);
  assert.deepEqual(await ids('q=inv/2026-27/00104'), [inv['00104']]);
  assert.deepEqual(await ids('q=.*'), []);
  assert.deepEqual(await ids('q=9876543210'), [inv['00001']]);
});

test('table, method, cashier filters', async () => {
  assert.deepEqual(await ids('table=t5'), [inv['00002']]);
  assert.deepEqual(await ids('method=upi'), [inv['00002']]);
  assert.deepEqual(await ids('method=cash'), [inv['00001']]);
  assert.deepEqual(await ids(`cashier=${otherUser._id}`), [inv['00003']]);
});

test('date range is IST calendar days', async () => {
  assert.deepEqual(await ids('from=2026-03-10&to=2026-03-10'), [inv['00001']]);
  assert.deepEqual(await ids('from=2026-03-11&to=2026-03-12'), [inv['00003'], inv['00002']]);
  assert.deepEqual(await ids('from=2026-03-12'), [inv['00104'], inv['00003']]);
  assert.deepEqual(await ids('to=2026-03-10'), [inv['00001']]);
});

test('pagination keeps a plain array, newest first', async () => {
  assert.deepEqual(await ids('limit=2&page=1'), [inv['00104'], inv['00003']]);
  assert.deepEqual(await ids('limit=2&page=2'), [inv['00002'], inv['00001']]);
  assert.deepEqual(await ids('limit=2&page=3'), []);
});

test('validation and roles', async () => {
  for (const qs of [
    'page=0',
    'method=x',
    'cashier=bad',
    'from=2026-3-1',
    'from=2026-03-12&to=2026-03-10',
  ])
    assert.equal((await cashier('GET', `/invoices?${qs}`)).status, 422, qs);
  assert.equal((await waiter('GET', '/invoices')).status, 403);
});

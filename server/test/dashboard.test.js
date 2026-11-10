import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { start, makeUser, client } from './setup.js';
import { Invoice } from '../src/models/Invoice.js';
import { RunningBill } from '../src/models/RunningBill.js';
import { Table } from '../src/models/Table.js';
import { todayIST } from '../src/routes/reports.js';

const oid = () => new mongoose.Types.ObjectId();
let ctx, admin, cashier, waiter, cashierUser, otherUser;
let n = 0;

const makeInvoice = (cashierId, grandTotal, payments, createdAt = new Date()) => {
  n += 1;
  return Invoice.create({
    invoiceNumber: `INV/2026-27/${String(n).padStart(5, '0')}`,
    billId: oid(),
    billNumber: `RB-${n}`,
    idempotencyKey: `dk${n}`,
    tableNumber: 'T1',
    items: [{ name: 'Tea', qty: 1, rate: grandTotal, amount: grandTotal }],
    subtotal: grandTotal,
    taxableAmount: grandTotal,
    gstRate: 0,
    cgst: 0,
    sgst: 0,
    roundOff: 0,
    grandTotal,
    payments,
    cashierId,
    cashierName: 'x',
    createdAt,
  });
};

const bill = (status, subtotal, tableId) => {
  n += 1;
  return RunningBill.create({
    billNumber: `RB-D${n}`,
    customerId: oid(),
    customerMobile: '9876543210',
    tableId,
    tableNumber: `T${n}`,
    status,
    subtotal,
  });
};

before(async () => {
  ctx = await start();
  await makeUser({ username: 'admin', role: 'admin' });
  cashierUser = await makeUser({ username: 'cashier', role: 'cashier' });
  otherUser = await makeUser({ username: 'cashier2', role: 'cashier' });
  await makeUser({ username: 'waiter', role: 'waiter' });
  [admin, cashier, waiter] = await Promise.all(
    ['admin', 'cashier', 'waiter'].map((u) => client(ctx.base, u)),
  );

  await makeInvoice(cashierUser._id, 1000, [{ method: 'cash', amount: 1000 }]);
  await makeInvoice(cashierUser._id, 3000, [
    { method: 'upi', amount: 2000 },
    { method: 'card', amount: 1000 },
  ]);
  await makeInvoice(cashierUser._id, 0, []); // 100% discount
  await makeInvoice(otherUser._id, 5000, [{ method: 'cash', amount: 5000 }]);
  await makeInvoice(
    cashierUser._id,
    9999,
    [{ method: 'cash', amount: 9999 }],
    new Date(Date.now() - 2 * 86400000),
  );

  await Table.create([
    { tableNumber: 'T1', capacity: 4 },
    { tableNumber: 'T2', capacity: 4, status: 'occupied' },
    { tableNumber: 'T3', capacity: 4, status: 'billing' },
    { tableNumber: 'T4', capacity: 4, status: 'occupied', isActive: false },
  ]);
  await bill('open', 1500, oid());
  await bill('billing', 2500, oid());
  await bill('paid', 7000, oid());
});
after(() => ctx.stop());

test('admin sees all of today', async () => {
  const r = await admin('GET', '/dashboard/summary');
  assert.equal(r.status, 200);
  const d = r.json.data;
  assert.equal(d.date, todayIST());
  assert.equal(d.sales, 9000);
  assert.equal(d.billCount, 4);
  assert.deepEqual(d.paymentSplit, { cash: 6000, upi: 2000, card: 1000 });
  assert.deepEqual(d.openBills, { count: 2, value: 4000 });
  assert.deepEqual(d.tables, { available: 1, occupied: 1, billing: 1, total: 3 });
  assert.equal(d.recentInvoices.length, 4);
  assert.ok(d.recentInvoices[0].invoiceNumber);
});

test('cashier sees only own invoices today; floor state unrestricted', async () => {
  const d = (await cashier('GET', '/dashboard/summary')).json.data;
  assert.equal(d.sales, 4000);
  assert.equal(d.billCount, 3);
  assert.deepEqual(d.paymentSplit, { cash: 1000, upi: 2000, card: 1000 });
  assert.equal(d.recentInvoices.length, 3);
  assert.deepEqual(d.openBills, { count: 2, value: 4000 });
  assert.equal(d.tables.total, 3);
});

test('waiter → 403', async () => {
  assert.equal((await waiter('GET', '/dashboard/summary')).status, 403);
});

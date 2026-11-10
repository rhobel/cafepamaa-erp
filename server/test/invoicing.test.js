import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { start, makeUser, client } from './setup.js';
import { Table } from '../src/models/Table.js';
import { Category } from '../src/models/Category.js';
import { MenuItem } from '../src/models/MenuItem.js';
import { Customer } from '../src/models/Customer.js';
import { RunningBill } from '../src/models/RunningBill.js';
import { Invoice } from '../src/models/Invoice.js';
import { Counter } from '../src/models/Counter.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Settings, getSettings } from '../src/models/Settings.js';
import { financialYear } from '../src/services/counters.js';

const FY = financialYear();
let ctx, admin, waiter, cashier, admUser, cashUser, menu, tables, customers;
before(async () => {
  ctx = await start();
  admUser = await makeUser({ username: 'admin', role: 'admin' });
  await makeUser({ username: 'waiter', role: 'waiter' });
  cashUser = await makeUser({ username: 'cashier', role: 'cashier', maxDiscountPercent: 10 });
  [admin, waiter, cashier] = await Promise.all(
    ['admin', 'waiter', 'cashier'].map((u) => client(ctx.base, u)),
  );
  await getSettings();
  await Settings.updateOne(
    { _id: 'restaurant' },
    { name: 'PAMAA', address: 'MG Road', gstin: '29abcde1234f1z5' },
  );
  const cat = await Category.create({ name: 'Food' });
  const items = await MenuItem.create([
    { name: 'Masala Dosa', categoryId: cat._id, price: 8000 },
    { name: 'Coffee', categoryId: cat._id, price: 3000 },
    { name: 'Paneer Dosa', categoryId: cat._id, price: 14000 },
    { name: 'Thali', categoryId: cat._id, price: 13000, addOns: [{ name: 'Ghee', price: 1000 }] },
    { name: 'Lassi', categoryId: cat._id, price: 12100 },
    { name: 'Tea', categoryId: cat._id, price: 2000 },
  ]);
  menu = Object.fromEntries(items.map((m) => [m.name, m]));
  tables = await Table.create(
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ tableNumber: `T${n}`, capacity: 4 })),
  );
  customers = await Customer.create(
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ mobile: `910000000${n}`, name: `Guest ${n}` })),
  );
});
after(() => ctx.stop());

const line = (name, qty, addOn = false) => ({
  menuItemId: String(menu[name]._id),
  qty,
  addOnIds: addOn ? [String(menu[name].addOns[0]._id)] : [],
});
/** Places each round as the waiter (first opens the bill on table n for customer n). Returns the open bill. */
async function openBill(n, rounds) {
  let bill = null;
  for (const items of rounds) {
    const r = await waiter('POST', '/bills/orders', {
      billId: bill?._id ?? null,
      customerId: String(customers[n - 1]._id),
      tableId: bill ? undefined : String(tables[n - 1]._id),
      items,
      idempotencyKey: randomUUID(),
    });
    assert.equal(r.status, 201, r.json.message);
    bill = r.json.data.bill;
  }
  return bill;
}
async function checkedOut(n, rounds) {
  const bill = await openBill(n, rounds);
  assert.equal((await cashier('POST', `/bills/${bill._id}/checkout`)).status, 200);
  return bill;
}
const DOCS_ROUNDS = () => [
  [line('Masala Dosa', 1), line('Coffee', 3)],
  [line('Masala Dosa', 1), line('Paneer Dosa', 1)],
]; // subtotal 39000
const invoice = (who, bill, body) =>
  who('POST', `/bills/${bill._id}/invoice`, {
    discount: null,
    idempotencyKey: randomUUID(),
    ...body,
  });

test('docs example: ₹390, 10% off, cash 300 + UPI 69 → paid invoice, table freed', async () => {
  const bill = await checkedOut(1, DOCS_ROUNDS());
  assert.equal(bill.subtotal, 39000);
  const r = await invoice(cashier, bill, {
    discount: { type: 'percent', value: 10 },
    payments: [
      { method: 'cash', amount: 30000 },
      { method: 'upi', amount: 6900, reference: 'UPI123456' },
    ],
  });
  assert.equal(r.status, 201, r.json.message);
  const inv = r.json.data;
  assert.equal(r.json.message, `Invoice INV/${FY}/00001 generated`);
  assert.equal(inv.invoiceNumber, `INV/${FY}/00001`);
  assert.equal(inv.billNumber, bill.billNumber);
  assert.equal(inv.tableNumber, 'T1');
  assert.deepEqual(inv.customer, {
    customerId: String(customers[0]._id),
    name: 'Guest 1',
    mobile: '9100000001',
  });
  assert.deepEqual(inv.restaurant, {
    name: 'PAMAA',
    address: 'MG Road',
    phone: '',
    gstin: '29ABCDE1234F1Z5',
    logoUrl: '',
    footer: 'Thank you · Visit again',
  });
  assert.deepEqual(
    inv.items.map(({ name, qty, rate, amount }) => [name, qty, rate, amount]),
    [
      ['Masala Dosa', 2, 8000, 16000],
      ['Coffee', 3, 3000, 9000],
      ['Paneer Dosa', 1, 14000, 14000],
    ],
  );
  assert.equal(
    inv.items.reduce((s, i) => s + i.amount, 0),
    inv.subtotal,
  );
  assert.equal(inv.subtotal, 39000);
  assert.equal(inv.discount.amount, 3900);
  assert.equal(inv.discount.approvedBy, String(cashUser._id));
  assert.equal(inv.taxableAmount, 35100);
  assert.equal(inv.gstRate, 5);
  assert.equal(inv.cgst, 878);
  assert.equal(inv.sgst, 878);
  assert.equal(inv.roundOff, 44);
  assert.equal(inv.grandTotal, 36900);
  assert.equal(inv.cashierName, 'cashier');
  assert.deepEqual(
    inv.payments.map(({ method, amount, tendered, change, reference }) => ({
      method,
      amount,
      tendered,
      change,
      reference,
    })),
    [
      { method: 'cash', amount: 30000, tendered: 30000, change: 0, reference: '' },
      { method: 'upi', amount: 6900, tendered: null, change: 0, reference: 'UPI123456' },
    ],
  );

  const b = await RunningBill.findById(bill._id);
  assert.equal(b.status, 'paid');
  assert.ok(b.closedAt);
  assert.equal(String(b.invoiceId), inv._id);
  const t = await Table.findById(tables[0]._id);
  assert.equal(t.status, 'available');
  assert.equal(t.currentBillId, null);
  const c = await Customer.findById(customers[0]._id);
  assert.equal(c.totalVisits, 1);
  assert.equal(c.totalSpent, 36900);
  assert.ok(c.lastVisitAt);

  const log = await AuditLog.findOne({ action: 'invoice.create' }).lean();
  assert.equal(log.details.invoiceNumber, inv.invoiceNumber);
  assert.equal(log.details.grandTotal, 36900);
  assert.equal(log.details.discount.amount, 3900);
  const dlog = await AuditLog.findOne({ action: 'bill.discount' }).lean();
  assert.equal(String(dlog.entityId), bill._id);
  assert.equal(dlog.details.amount, 3900);
});

test('after invoice a new order opens a new bill on the same table', async () => {
  const fresh = await openBill(1, [[line('Tea', 1)]]);
  assert.equal(fresh.status, 'open');
  assert.equal((await Table.findById(tables[0]._id)).status, 'occupied');
});

test('split ₹500 cash + ₹740 UPI on ₹1,240; mismatch → 422 and nothing changes', async () => {
  const opened = await openBill(2, [
    [line('Thali', 1, true), line('Thali', 6), line('Lassi', 1)],
    [line('Thali', 1, true), line('Tea', 1)],
  ]);
  const tea = opened.rounds[1].items[1];
  const v = await admin('PATCH', `/bills/${opened._id}/items/${tea._id}/void`, { reason: 'Wrong' });
  assert.equal(v.status, 200);
  assert.equal(v.json.data.subtotal, 118100);
  const bill = opened;
  assert.equal((await cashier('POST', `/bills/${bill._id}/checkout`)).status, 200);

  const seqBefore = (await Counter.findById(`invoice-${FY}`)).seq;
  for (const amounts of [
    [50000, 74100],
    [50000, 73900],
  ]) {
    const bad = await invoice(cashier, bill, {
      payments: [
        { method: 'cash', amount: amounts[0] },
        { method: 'upi', amount: amounts[1] },
      ],
    });
    assert.equal(bad.status, 422);
    assert.match(bad.json.message, /^Payments total ₹1,2\d\d\.00 but the bill is ₹1,240\.00$/);
  }
  assert.equal((await RunningBill.findById(bill._id)).status, 'billing');
  assert.equal(await Invoice.countDocuments({ billId: bill._id }), 0);
  assert.equal((await Counter.findById(`invoice-${FY}`)).seq, seqBefore);

  const r = await invoice(cashier, bill, {
    payments: [
      { method: 'cash', amount: 50000 },
      { method: 'upi', amount: 74000 },
    ],
  });
  assert.equal(r.status, 201, r.json.message);
  assert.equal(r.json.data.grandTotal, 124000);
  assert.equal(r.json.data.invoiceNumber, `INV/${FY}/00002`);
  assert.equal(r.json.data.discount, undefined);
  assert.equal(await AuditLog.countDocuments({ action: 'bill.discount' }), 1); // only the docs example
  assert.deepEqual(
    r.json.data.items.map(({ name, addOns, qty, rate, amount }) => [
      name,
      addOns.map((a) => a.name),
      qty,
      rate,
      amount,
    ]),
    [
      ['Thali', ['Ghee'], 2, 14000, 28000],
      ['Thali', [], 6, 13000, 78000],
      ['Lassi', [], 1, 12100, 12100],
    ],
  );
});

test('cash tendered ₹500 for ₹369 → change ₹131; tendered below amount → 422', async () => {
  const bill = await checkedOut(3, DOCS_ROUNDS());
  const discount = { type: 'percent', value: 10 };
  const low = await invoice(cashier, bill, {
    discount,
    payments: [{ method: 'cash', amount: 36900, tendered: 30000 }],
  });
  assert.equal(low.status, 422);
  const r = await invoice(cashier, bill, {
    discount,
    payments: [{ method: 'cash', amount: 36900, tendered: 50000 }],
  });
  assert.equal(r.status, 201, r.json.message);
  assert.equal(r.json.data.payments[0].tendered, 50000);
  assert.equal(r.json.data.payments[0].change, 13100);
});

test('idempotency: sequential replay → 200 same invoice; concurrent → exactly one', async () => {
  const bill = await checkedOut(4, DOCS_ROUNDS()); // 41000 without discount
  const body = { payments: [{ method: 'card', amount: 41000 }], idempotencyKey: randomUUID() };
  const first = await invoice(cashier, bill, body);
  assert.equal(first.status, 201, first.json.message);
  const again = await invoice(cashier, bill, body);
  assert.equal(again.status, 200);
  assert.equal(again.json.data.invoiceNumber, first.json.data.invoiceNumber);
  assert.equal(again.json.data._id, first.json.data._id);

  const other = await invoice(cashier, bill, { payments: body.payments });
  assert.equal(other.status, 409);
  assert.equal(other.json.message, 'Invoice already generated for this bill');
  assert.equal(await Invoice.countDocuments({ billId: bill._id }), 1);

  const bill2 = await checkedOut(5, DOCS_ROUNDS());
  const body2 = { payments: [{ method: 'upi', amount: 41000 }], idempotencyKey: randomUUID() };
  const both = await Promise.all([invoice(cashier, bill2, body2), invoice(cashier, bill2, body2)]);
  for (const r of both) assert.ok([200, 201].includes(r.status), `${r.status} ${r.json.message}`);
  assert.deepEqual(both.map((r) => r.status).sort(), [200, 201]);
  assert.equal(both[0].json.data.invoiceNumber, both[1].json.data.invoiceNumber);
  assert.equal(await Invoice.countDocuments({ billId: bill2._id }), 1);
  assert.equal((await Customer.findById(customers[4]._id)).totalVisits, 1);
});

test('open bill → 409; waiter → 403; cashier over discount limit → 403; admin unlimited', async () => {
  const bill = await openBill(6, DOCS_ROUNDS());
  const pay = { payments: [{ method: 'cash', amount: 41000 }] };
  const open = await invoice(cashier, bill, pay);
  assert.equal(open.status, 409);
  assert.equal(open.json.message, 'Proceed to checkout first');

  await cashier('POST', `/bills/${bill._id}/checkout`);
  assert.equal((await invoice(waiter, bill, pay)).status, 403);
  const over = await invoice(cashier, bill, {
    discount: { type: 'percent', value: 15 },
    payments: [{ method: 'cash', amount: 34800 }],
  });
  assert.equal(over.status, 403);
  assert.equal(over.json.message, 'Discount above your limit of 10%');
  const flatOver = await invoice(cashier, bill, {
    discount: { type: 'flat', value: 3901 },
    payments: [{ method: 'cash', amount: 36900 }],
  });
  assert.equal(flatOver.status, 403);
  assert.equal((await invoice(cashier, bill, { payments: [] })).status, 422);
  assert.equal((await invoice(cashier, bill, { ...pay, idempotencyKey: 'short' })).status, 422);

  // 50% of 39000 → 19500 taxable, 488 + 488 → 20476 → 20500
  const r = await invoice(admin, bill, {
    discount: { type: 'percent', value: 50 },
    payments: [{ method: 'cash', amount: 20500 }],
  });
  assert.equal(r.status, 201, r.json.message);
  assert.equal(r.json.data.discount.approvedBy, String(admUser._id));
});

test('invoiceStartNumber 100 jumps the sequence to 00100', async () => {
  await Settings.updateOne({ _id: 'restaurant' }, { invoiceStartNumber: 100 });
  const bill = await checkedOut(7, DOCS_ROUNDS());
  const r = await invoice(cashier, bill, { payments: [{ method: 'cash', amount: 41000 }] });
  assert.equal(r.status, 201, r.json.message);
  assert.equal(r.json.data.invoiceNumber, `INV/${FY}/00100`);
});

test('100% discount by admin → grandTotal 0 with no payments', async () => {
  const bill = await checkedOut(8, DOCS_ROUNDS());
  const r = await invoice(admin, bill, { discount: { type: 'percent', value: 100 }, payments: [] });
  assert.equal(r.status, 201, r.json.message);
  assert.equal(r.json.data.grandTotal, 0);
  assert.deepEqual(r.json.data.payments, []);
  assert.equal((await RunningBill.findById(bill._id)).status, 'paid');
  assert.equal((await Table.findById(tables[7]._id)).status, 'available');
});

test('a rejected attempt does not burn its idempotencyKey', async () => {
  const bill = await checkedOut(9, DOCS_ROUNDS());
  const idempotencyKey = randomUUID();
  const bad = await invoice(cashier, bill, {
    idempotencyKey,
    payments: [{ method: 'cash', amount: 40000 }],
  });
  assert.equal(bad.status, 422);
  const good = await invoice(cashier, bill, {
    idempotencyKey,
    payments: [{ method: 'cash', amount: 41000 }],
  });
  assert.equal(good.status, 201, good.json.message);
});

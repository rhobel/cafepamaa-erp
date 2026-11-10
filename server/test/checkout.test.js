import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { start, makeUser, client } from './setup.js';
import { Table } from '../src/models/Table.js';
import { Category } from '../src/models/Category.js';
import { MenuItem } from '../src/models/MenuItem.js';
import { Customer } from '../src/models/Customer.js';
import { RunningBill } from '../src/models/RunningBill.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Settings, getSettings } from '../src/models/Settings.js';

let ctx, admin, waiter, cashier, thali, tea, t1, t2, c1, c2, c3;
before(async () => {
  ctx = await start();
  await makeUser({ username: 'admin', role: 'admin' });
  await makeUser({ username: 'waiter', role: 'waiter' });
  await makeUser({ username: 'cashier', role: 'cashier', maxDiscountPercent: 10 });
  [admin, waiter, cashier] = await Promise.all(
    ['admin', 'waiter', 'cashier'].map((u) => client(ctx.base, u)),
  );
  const cat = await Category.create({ name: 'Food' });
  [thali, tea] = await MenuItem.create([
    { name: 'Thali', categoryId: cat._id, price: 13000 },
    { name: 'Tea', categoryId: cat._id, price: 2000 },
  ]);
  [t1, t2] = await Table.create(['T1', 'T2'].map((n) => ({ tableNumber: n, capacity: 4 })));
  [c1, c2, c3] = await Customer.create(
    ['9100000001', '9100000002', '9100000003'].map((mobile) => ({ mobile })),
  );
});
after(() => ctx.stop());

const order = async (body, items = [{ menuItemId: String(thali._id), qty: 3, addOnIds: [] }]) => {
  const r = await waiter('POST', '/bills/orders', {
    billId: null,
    items,
    idempotencyKey: randomUUID(),
    ...body,
  });
  return r;
};

let bill; // T1, subtotal 39000
test('checkout moves bill + table to billing and returns calc; idempotent', async () => {
  const r = await order({ customerId: String(c1._id), tableId: String(t1._id) });
  assert.equal(r.status, 201);
  bill = r.json.data.bill;
  assert.equal(bill.subtotal, 39000);

  const co = await cashier('POST', `/bills/${bill._id}/checkout`);
  assert.equal(co.status, 200);
  assert.equal(co.json.data.bill.status, 'billing');
  assert.deepEqual(co.json.data.calc, {
    subtotal: 39000,
    discount: null,
    taxableAmount: 39000,
    cgstRate: 2.5,
    sgstRate: 2.5,
    cgst: 975,
    sgst: 975,
    roundOff: 50,
    grandTotal: 41000,
    pricesIncludeTax: false,
  });
  assert.equal((await Table.findById(t1._id)).status, 'billing');

  const again = await cashier('POST', `/bills/${bill._id}/checkout`);
  assert.equal(again.status, 200);
  assert.equal(again.json.data.bill.status, 'billing');
});

test('waiter → 403 on every route; bad ids → 422; unknown → 404', async () => {
  const id = bill._id;
  const itemId = bill.rounds[0].items[0]._id;
  const calls = [
    ['POST', `/bills/${id}/checkout`],
    ['POST', `/bills/${id}/calculate`, { discount: null }],
    ['POST', `/bills/${id}/cancel-checkout`],
    ['PATCH', `/bills/${id}/items/${itemId}/void`, { reason: 'wrong' }],
    ['POST', `/bills/${id}/cancel`, { reason: 'walkout' }],
  ];
  for (const [m, p, b] of calls) assert.equal((await waiter(m, p, b)).status, 403, p);
  assert.equal((await cashier('PATCH', calls[3][1], calls[3][2])).status, 403);
  assert.equal((await cashier('POST', calls[4][1], calls[4][2])).status, 403);

  assert.equal((await cashier('POST', '/bills/nope/checkout')).status, 422);
  assert.equal(
    (await admin('PATCH', `/bills/${id}/items/nope/void`, { reason: 'x1x' })).status,
    422,
  );
  assert.equal((await cashier('POST', '/bills/000000000000000000000000/checkout')).status, 404);
  const unknownItem = await admin('PATCH', `/bills/${id}/items/000000000000000000000000/void`, {
    reason: 'wrong',
  });
  assert.equal(unknownItem.status, 404);
});

test('calculate: discount limit for cashier, admin unlimited, validation', async () => {
  const calc = (who, discount) => who('POST', `/bills/${bill._id}/calculate`, { discount });

  const ok10 = await calc(cashier, { type: 'percent', value: 10 });
  assert.equal(ok10.status, 200);
  assert.equal(ok10.json.data.discount.amount, 3900);
  assert.equal(ok10.json.data.taxableAmount, 35100);
  assert.equal(ok10.json.data.grandTotal, 36900); // 35100 + 878 + 878 = 36856 → 36900

  const p15 = await calc(cashier, { type: 'percent', value: 15 });
  assert.equal(p15.status, 403);
  assert.equal(p15.json.message, 'Discount above your limit of 10%');
  assert.equal((await calc(cashier, { type: 'flat', value: 3900 })).status, 200);
  assert.equal((await calc(cashier, { type: 'flat', value: 3901 })).status, 403);

  const a50 = await calc(admin, { type: 'percent', value: 50 });
  assert.equal(a50.status, 200);
  assert.equal(a50.json.data.discount.amount, 19500);

  assert.equal((await calc(cashier, null)).json.data.grandTotal, 41000);
  assert.equal((await calc(admin, { type: 'flat', value: 12.5 })).status, 422);
  assert.equal((await calc(admin, { type: 'percent', value: 2.555 })).status, 422);
  assert.equal((await calc(admin, { type: 'bogus', value: 1 })).status, 422);
  // nothing persisted
  assert.equal((await RunningBill.findById(bill._id)).subtotal, 39000);
});

test('POS order on a billing bill → 409; cancel-checkout restores open/occupied', async () => {
  const add = await order({ customerId: String(c1._id), billId: bill._id });
  assert.equal(add.status, 409);

  const cc = await cashier('POST', `/bills/${bill._id}/cancel-checkout`);
  assert.equal(cc.status, 200);
  assert.equal(cc.json.data.status, 'open');
  assert.equal((await Table.findById(t1._id)).status, 'occupied');
  assert.equal((await cashier('POST', `/bills/${bill._id}/cancel-checkout`)).status, 200);

  const calcOpen = await cashier('POST', `/bills/${bill._id}/calculate`, { discount: null });
  assert.equal(calcOpen.status, 409);
});

test('void recomputes subtotal and audits; double void → 409', async () => {
  const add = await order({ customerId: String(c1._id), billId: bill._id }, [
    { menuItemId: String(tea._id), qty: 2, addOnIds: [] },
  ]);
  assert.equal(add.status, 201);
  bill = add.json.data.bill;
  assert.equal(bill.subtotal, 43000);
  const teaItem = bill.rounds[1].items[0];

  const v = await admin('PATCH', `/bills/${bill._id}/items/${teaItem._id}/void`, {
    reason: 'Customer changed mind',
  });
  assert.equal(v.status, 200);
  assert.equal(v.json.data.subtotal, 39000);
  assert.equal(v.json.data.rounds[1].items[0].isVoided, true);
  assert.equal(v.json.data.rounds[1].items[0].voidReason, 'Customer changed mind');
  const log = await AuditLog.findOne({ action: 'bill.voidItem' }).lean();
  assert.equal(String(log.entityId), bill._id);
  assert.deepEqual(
    { ...log.details, itemId: String(log.details.itemId) },
    { itemId: teaItem._id, name: 'Tea', qty: 2, lineTotal: 4000, reason: 'Customer changed mind' },
  );

  const again = await admin('PATCH', `/bills/${bill._id}/items/${teaItem._id}/void`, {
    reason: 'again',
  });
  assert.equal(again.status, 409);
  const shortReason = await admin('PATCH', `/bills/${bill._id}/items/${teaItem._id}/void`, {
    reason: 'no',
  });
  assert.equal(shortReason.status, 422);
});

test('cancel with items → 409; after voiding all → cancelled, table freed, new bill opens', async () => {
  const early = await admin('POST', `/bills/${bill._id}/cancel`, { reason: 'Walk-out' });
  assert.equal(early.status, 409);
  assert.equal(early.json.message, 'Void all items before cancelling the bill');

  const thaliItem = bill.rounds[0].items[0];
  await admin('PATCH', `/bills/${bill._id}/items/${thaliItem._id}/void`, { reason: 'Walk-out' });
  const c = await admin('POST', `/bills/${bill._id}/cancel`, { reason: 'Walk-out' });
  assert.equal(c.status, 200);
  assert.equal(c.json.data.status, 'cancelled');
  assert.ok(c.json.data.closedAt);
  const table = await Table.findById(t1._id);
  assert.equal(table.status, 'available');
  assert.equal(table.currentBillId, null);
  assert.equal((await AuditLog.findOne({ action: 'bill.cancel' })).details.reason, 'Walk-out');

  assert.equal((await admin('POST', `/bills/${bill._id}/cancel`, { reason: 'again' })).status, 409);
  assert.equal((await cashier('POST', `/bills/${bill._id}/checkout`)).status, 409);

  const fresh = await order({ customerId: String(c2._id), tableId: String(t1._id) });
  assert.equal(fresh.status, 201);
  assert.notEqual(fresh.json.data.bill._id, bill._id);
});

test('inclusive-tax settings change the calc', async () => {
  await getSettings();
  await Settings.updateOne({ _id: 'restaurant' }, { pricesIncludeTax: true });
  const r = await order({ customerId: String(c3._id), tableId: String(t2._id) });
  const co = await admin('POST', `/bills/${r.json.data.bill._id}/checkout`);
  assert.equal(co.status, 200);
  const { calc } = co.json.data;
  assert.equal(calc.pricesIncludeTax, true);
  assert.equal(calc.taxableAmount, 37143);
  assert.equal(calc.cgst, 929);
  assert.equal(calc.sgst, 928);
  assert.equal(calc.grandTotal, 39000);
  assert.equal(calc.roundOff, 0);
});

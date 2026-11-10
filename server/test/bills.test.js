import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { start, makeUser, client } from './setup.js';
import { Table } from '../src/models/Table.js';
import { Category } from '../src/models/Category.js';
import { MenuItem } from '../src/models/MenuItem.js';
import { RunningBill } from '../src/models/RunningBill.js';
import { AuditLog } from '../src/models/AuditLog.js';

let ctx, admin, waiter, waiter2, cashier, dosa, coffee, t1, t2, t3;
before(async () => {
  ctx = await start();
  await makeUser({ username: 'admin', role: 'admin' });
  await makeUser({ username: 'waiter', role: 'waiter' });
  await makeUser({ username: 'waiter2', role: 'waiter' });
  await makeUser({ username: 'cashier', role: 'cashier' });
  [admin, waiter, waiter2, cashier] = await Promise.all(
    ['admin', 'waiter', 'waiter2', 'cashier'].map((u) => client(ctx.base, u)),
  );
  const cat = await Category.create({ name: 'Food' });
  [dosa, coffee] = await MenuItem.create([
    { name: 'Dosa', categoryId: cat._id, price: 8000, addOns: [{ name: 'Cheese', price: 2000 }] },
    { name: 'Coffee', categoryId: cat._id, price: 3000 },
  ]);
  [t1, t2, t3] = await Table.create(
    ['T1', 'T2', 'T3'].map((n) => ({ tableNumber: n, capacity: 4 })),
  );
});
after(() => ctx.stop());

const customer = async (mobile) => (await waiter('POST', '/customers', { mobile })).json.data._id;
const order = (who, body) =>
  who('POST', '/bills/orders', {
    billId: null,
    items: [{ menuItemId: String(coffee._id), qty: 1, addOnIds: [] }],
    idempotencyKey: randomUUID(),
    ...body,
  });

let bill1;
test('new customer without name orders; table occupied; second round on same bill', async () => {
  const customerId = await customer('9000000001');
  const r = await order(waiter, {
    customerId,
    tableId: String(t1._id),
    items: [
      {
        menuItemId: String(dosa._id),
        qty: 2,
        addOnIds: [String(dosa.addOns[0]._id)],
        instructions: 'less oil',
      },
    ],
  });
  assert.equal(r.status, 201);
  const { bill, orderNumber } = r.json.data;
  assert.match(bill.billNumber, /^RB-\d{4}$/);
  assert.match(orderNumber, /^ORD-\d{4}$/);
  assert.equal(r.json.message, `Order ${orderNumber} saved to Bill ${bill.billNumber} · Table T1`);
  assert.equal(bill.rounds[0].items[0].lineTotal, 20000);
  assert.equal(bill.rounds[0].waiterName, 'waiter');
  assert.equal(bill.subtotal, 20000);
  const table = await Table.findById(t1._id);
  assert.equal(table.status, 'occupied');
  assert.equal(String(table.currentBillId), bill._id);
  assert.equal(await AuditLog.countDocuments({ action: 'bill.order' }), 1);

  const look = await waiter('GET', '/customers?mobile=9000000001');
  assert.equal(look.json.data.activeBill.billNumber, bill.billNumber);

  const r2 = await order(waiter, { customerId, billId: bill._id });
  assert.equal(r2.status, 201);
  assert.equal(r2.json.data.bill._id, bill._id);
  assert.equal(r2.json.data.bill.rounds.length, 2);
  assert.equal(r2.json.data.bill.subtotal, 23000);
  bill1 = r2.json.data.bill;

  const again = await order(waiter, { customerId, tableId: String(t2._id) });
  assert.equal(again.status, 409);
  assert.equal(again.json.data.billId, bill._id);

  const byTable = await cashier('GET', `/bills/active-by-table/${t1._id}`);
  assert.equal(byTable.json.data._id, bill._id);
  assert.equal((await cashier('GET', `/bills/active-by-table/${t2._id}`)).json.data, null);
});

test('price change after order does not alter saved round', async () => {
  await MenuItem.updateOne({ _id: dosa._id }, { price: 9900, name: 'Dosa XL' });
  const { json } = await waiter('GET', `/bills/${bill1._id}`);
  assert.equal(json.data.rounds[0].items[0].price, 8000);
  assert.equal(json.data.rounds[0].items[0].name, 'Dosa');
  assert.equal(json.data.subtotal, 23000);
  assert.equal((await waiter('GET', '/bills/000000000000000000000000')).status, 404);
});

test('two concurrent orders for one table → one 201, one 409', async () => {
  const [a, b] = [await customer('9000000002'), await customer('9000000003')];
  const res = await Promise.all([
    order(waiter, { customerId: a, tableId: String(t2._id) }),
    order(waiter2, { customerId: b, tableId: String(t2._id) }),
  ]);
  assert.deepEqual(res.map((r) => r.status).sort(), [201, 409]);
  assert.equal(
    res.find((r) => r.status === 409).json.message,
    'Table T2 was just taken. Please pick another table.',
  );
  assert.equal(await RunningBill.countDocuments({ tableId: t2._id }), 1);
});

test('unavailable item → 422 with data.unavailable; nothing saved', async () => {
  await MenuItem.updateOne({ _id: coffee._id }, { isAvailable: false });
  const customerId = await customer('9000000004');
  const r = await order(waiter, { customerId, tableId: String(t3._id) });
  assert.equal(r.status, 422);
  assert.equal(r.json.message, 'Coffee is no longer available.');
  assert.deepEqual(r.json.data.unavailable, [String(coffee._id)]);
  assert.equal((await Table.findById(t3._id)).status, 'available');
  await MenuItem.updateOne({ _id: coffee._id }, { isAvailable: true });

  const badAddOn = await order(waiter, {
    billId: bill1._id,
    customerId,
    items: [{ menuItemId: String(coffee._id), qty: 1, addOnIds: [String(dosa.addOns[0]._id)] }],
  });
  assert.equal(badAddOn.status, 422);
});

test('idempotency replay returns the same bill with one round', async () => {
  const customerId = await customer('9000000005');
  const body = { customerId, tableId: String(t3._id), idempotencyKey: randomUUID() };
  const first = await order(waiter, body);
  const second = await order(waiter, body);
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.json.data.bill._id, first.json.data.bill._id);
  assert.equal(second.json.data.orderNumber, first.json.data.orderNumber);
  assert.equal((await RunningBill.findById(first.json.data.bill._id)).rounds.length, 1);
});

test('cashier → 403; bill at checkout → 409', async () => {
  const r = await order(cashier, { customerId: bill1.customerId, billId: bill1._id });
  assert.equal(r.status, 403);
  await RunningBill.updateOne({ _id: bill1._id }, { status: 'billing' });
  const b = await order(admin, { customerId: bill1.customerId, billId: bill1._id });
  assert.equal(b.status, 409);
  assert.equal(b.json.message, "Bill is at checkout; new items can't be added");
});

test('GET /bills: waiter sees only own; admin all or mine', async () => {
  const w1 = (await waiter('GET', '/bills')).json.data;
  const w2 = (await waiter2('GET', '/bills?mine=false')).json.data;
  const all = (await admin('GET', '/bills')).json.data;
  assert.equal(all.length, 3);
  // The T2 race decides which waiter owns that bill; together they own each bill exactly once.
  const ids = (xs) => xs.map((b) => b._id).sort();
  assert.deepEqual(ids([...w1, ...w2]), ids(all));
  assert.ok(w1.length >= 2);
  assert.equal(w1[0].roundCount, 1); // newest first
  assert.equal(all.at(-1).roundCount, 2);
  assert.equal((await admin('GET', '/bills?mine=true')).json.data.length, 0);
  assert.equal((await admin('GET', '/bills?status=billing')).json.data.length, 1);
  assert.equal((await admin('GET', '/bills?status=nope')).status, 422);
});

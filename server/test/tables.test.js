import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, makeUser, client } from './setup.js';
import { Table } from '../src/models/Table.js';
import { AuditLog } from '../src/models/AuditLog.js';

let ctx, admin, waiter, cashier;
before(async () => {
  ctx = await start();
  await makeUser({ username: 'admin', role: 'admin' });
  await makeUser({ username: 'waiter', role: 'waiter' });
  await makeUser({ username: 'cashier', role: 'cashier' });
  admin = await client(ctx.base, 'admin');
  waiter = await client(ctx.base, 'waiter');
  cashier = await client(ctx.base, 'cashier');
});
after(() => ctx.stop());

const numbers = (json) => json.data.map((t) => t.tableNumber);

test('create, natural sort, duplicates', async () => {
  for (const n of ['T10', 't2', 'T1']) {
    const r = await admin('POST', '/tables', { tableNumber: n, capacity: 4, section: ' Patio ' });
    assert.equal(r.status, 201);
  }
  const { json } = await admin('GET', '/tables');
  assert.deepEqual(numbers(json), ['T1', 'T2', 'T10']);
  assert.equal(json.data[0].section, 'Patio');

  const dup = await admin('POST', '/tables', { tableNumber: 't10', capacity: 2 });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.message, 'Table T10 already exists');

  assert.equal((await admin('POST', '/tables', { tableNumber: 'T9', capacity: 0 })).status, 422);
  assert.equal((await admin('POST', '/tables', { tableNumber: '', capacity: 2 })).status, 422);
});

test('update ignores status/currentBillId; renumber duplicate → 409', async () => {
  const t2 = await Table.findOne({ tableNumber: 'T2' });
  const r = await admin('PATCH', `/tables/${t2._id}`, {
    capacity: 6,
    status: 'occupied',
    currentBillId: t2._id.toString(),
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.data.capacity, 6);
  assert.equal(r.json.data.status, 'available');
  assert.equal(r.json.data.currentBillId, null);

  const dup = await admin('PATCH', `/tables/${t2._id}`, { tableNumber: 't1' });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.message, 'Table T1 already exists');

  assert.equal((await admin('PATCH', '/tables/abc', { capacity: 2 })).status, 422);
  assert.equal(
    (await admin('PATCH', '/tables/000000000000000000000000', { capacity: 2 })).status,
    404,
  );

  const logs = await AuditLog.find({ entityId: t2._id, action: 'table.update' });
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0].details, { capacity: { from: 4, to: 6 } });
});

test('deactivate/renumber blocked while occupied; activate audits', async () => {
  const t1 = await Table.findOne({ tableNumber: 'T1' });
  await Table.updateOne({ _id: t1._id }, { status: 'occupied' });
  for (const body of [{ isActive: false }, { tableNumber: 'T99' }]) {
    const r = await admin('PATCH', `/tables/${t1._id}`, body);
    assert.equal(r.status, 409);
    assert.equal(r.json.message, 'Table T1 has an active bill');
  }
  assert.equal((await admin('PATCH', `/tables/${t1._id}`, { capacity: 8 })).status, 200);
  await Table.updateOne({ _id: t1._id }, { status: 'available' });

  assert.equal((await admin('PATCH', `/tables/${t1._id}`, { isActive: false })).status, 200);
  assert.equal((await admin('PATCH', `/tables/${t1._id}`, { isActive: true })).status, 200);
  const actions = (await AuditLog.find({ entityId: t1._id }).sort({ createdAt: 1 })).map(
    (l) => l.action,
  );
  assert.deepEqual(actions, ['table.create', 'table.update', 'table.deactivate', 'table.activate']);
});

test('roles: non-admins read active only, cannot write', async () => {
  const t10 = await Table.findOne({ tableNumber: 'T10' });
  await admin('PATCH', `/tables/${t10._id}`, { isActive: false });

  assert.deepEqual(numbers((await admin('GET', '/tables')).json), ['T1', 'T2', 'T10']);
  assert.deepEqual(numbers((await admin('GET', '/tables?active=true')).json), ['T1', 'T2']);
  for (const c of [waiter, cashier]) {
    const r = await c('GET', '/tables?active=false');
    assert.equal(r.status, 200);
    assert.deepEqual(numbers(r.json), ['T1', 'T2']);
    assert.equal((await c('POST', '/tables', { tableNumber: 'T7', capacity: 2 })).status, 403);
    assert.equal((await c('PATCH', `/tables/${t10._id}`, { capacity: 2 })).status, 403);
  }
});

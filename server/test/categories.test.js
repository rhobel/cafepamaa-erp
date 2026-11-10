import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, makeUser, client } from './setup.js';
import { MenuItem } from '../src/models/MenuItem.js';
import { AuditLog } from '../src/models/AuditLog.js';

let ctx, admin, waiter;
const ids = {};
before(async () => {
  ctx = await start();
  await makeUser({ username: 'admin', role: 'admin' });
  await makeUser({ username: 'waiter', role: 'waiter' });
  admin = await client(ctx.base, 'admin');
  waiter = await client(ctx.base, 'waiter');
});
after(() => ctx.stop());

test('create assigns increasing sortOrder', async () => {
  for (const [i, name] of ['Snacks', 'Beverages', 'Breakfast'].entries()) {
    const { status, json } = await admin('POST', '/categories', { name });
    assert.equal(status, 201);
    assert.equal(json.data.sortOrder, i);
    assert.equal(json.data.isActive, true);
    ids[name] = json.data._id;
  }
});

test('duplicate name is case-insensitive → 409', async () => {
  const { status, json } = await admin('POST', '/categories', { name: 'snacks' });
  assert.equal(status, 409);
  assert.equal(json.message, 'Category already exists');
  const rename = await admin('PATCH', `/categories/${ids.Beverages}`, { name: ' SNACKS ' });
  assert.equal(rename.status, 409);
});

test('validation, 404 and malformed id', async () => {
  assert.equal((await admin('POST', '/categories', { name: '' })).status, 422);
  assert.equal((await admin('POST', '/categories', { name: 'x'.repeat(41) })).status, 422);
  assert.equal((await admin('PATCH', '/categories/nope', { name: 'A' })).status, 422);
  assert.equal((await admin('PATCH', `/categories/${'0'.repeat(24)}`, { name: 'A' })).status, 404);
  assert.equal((await admin('DELETE', `/categories/${'0'.repeat(24)}`)).status, 404);
});

test('list is ordered and carries itemCount (ignores deleted items)', async () => {
  await MenuItem.create([
    { name: 'Samosa', categoryId: ids.Snacks, price: 2000 },
    { name: 'Pakora', categoryId: ids.Snacks, price: 3000 },
    { name: 'Old', categoryId: ids.Snacks, price: 1000, isDeleted: true },
    { name: 'Tea', categoryId: ids.Beverages, price: 1500 },
  ]);
  const { status, json } = await admin('GET', '/categories');
  assert.equal(status, 200);
  assert.deepEqual(
    json.data.map((c) => [c.name, c.itemCount]),
    [
      ['Snacks', 2],
      ['Beverages', 1],
      ['Breakfast', 0],
    ],
  );
});

test('reorder sets sortOrder by index and rejects wrong id sets', async () => {
  const order = [ids.Breakfast, ids.Snacks, ids.Beverages];
  assert.equal((await admin('POST', '/categories/reorder', { ids: order })).status, 200);
  const { json } = await admin('GET', '/categories');
  assert.deepEqual(
    json.data.map((c) => [c._id, c.sortOrder]),
    order.map((id, i) => [id, i]),
  );
  for (const bad of [
    order.slice(0, 2),
    [...order, ids.Snacks],
    [ids.Breakfast, ids.Snacks, '0'.repeat(24)],
  ]) {
    assert.equal((await admin('POST', '/categories/reorder', { ids: bad })).status, 422);
  }
  assert.equal((await admin('POST', '/categories/reorder', { ids: ['x'] })).status, 422);
});

test('delete is soft; patch reactivates; non-admins only see active', async () => {
  const del = await admin('DELETE', `/categories/${ids.Breakfast}`);
  assert.equal(del.status, 200);
  assert.equal(del.json.data.isActive, false);

  const all = await admin('GET', '/categories');
  assert.equal(all.json.data.length, 3);
  const active = await admin('GET', '/categories?active=true');
  assert.deepEqual(
    active.json.data.map((c) => c.name),
    ['Snacks', 'Beverages'],
  );
  const w = await waiter('GET', '/categories');
  assert.equal(w.status, 200);
  assert.deepEqual(
    w.json.data.map((c) => c.name),
    ['Snacks', 'Beverages'],
  );

  const re = await admin('PATCH', `/categories/${ids.Breakfast}`, {
    isActive: true,
    name: 'Morning',
  });
  assert.equal(re.status, 200);
  assert.equal(re.json.data.isActive, true);
  assert.equal(re.json.data.name, 'Morning');
});

test('non-admin writes → 403', async () => {
  assert.equal((await waiter('POST', '/categories', { name: 'Lunch' })).status, 403);
  assert.equal((await waiter('PATCH', `/categories/${ids.Snacks}`, { name: 'X' })).status, 403);
  assert.equal((await waiter('POST', '/categories/reorder', { ids: [ids.Snacks] })).status, 403);
  assert.equal((await waiter('DELETE', `/categories/${ids.Snacks}`)).status, 403);
});

test('writes are audited', async () => {
  const actions = (await AuditLog.find({ entity: 'category' }).lean()).map((a) => a.action);
  for (const a of ['category.create', 'category.update', 'category.deactivate', 'category.reorder'])
    assert.ok(actions.includes(a), `missing ${a}`);
  assert.equal(actions.filter((a) => a === 'category.create').length, 3);
});

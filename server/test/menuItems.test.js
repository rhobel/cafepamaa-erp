import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, makeUser, client } from './setup.js';
import { Category } from '../src/models/Category.js';
import { MenuItem } from '../src/models/MenuItem.js';
import { AuditLog } from '../src/models/AuditLog.js';

let ctx, admin, waiter, snacks, drinks;
before(async () => {
  ctx = await start();
  await makeUser({ username: 'admin', role: 'admin' });
  await makeUser({ username: 'waiter', role: 'waiter' });
  admin = await client(ctx.base, 'admin');
  waiter = await client(ctx.base, 'waiter');
  [snacks, drinks] = await Category.create([{ name: 'Snacks' }, { name: 'Drinks' }]);
});
after(() => ctx.stop());

const item = (over = {}) => ({
  name: 'Masala Dosa',
  categoryId: String(snacks._id),
  price: 8000,
  ...over,
});

test('create, read, list with filters', async () => {
  const c = await admin('POST', '/menu-items', item({ addOns: [{ name: 'Cheese', price: 2000 }] }));
  assert.equal(c.status, 201);
  assert.equal(c.json.data.price, 8000);
  assert.equal(c.json.data.isAvailable, true);
  await admin(
    'POST',
    '/menu-items',
    item({ name: 'Coffee (hot)', categoryId: String(drinks._id), price: 3000 }),
  );
  await admin('POST', '/menu-items', item({ name: 'Idli', isAvailable: false }));

  const g = await waiter('GET', `/menu-items/${c.json.data._id}`);
  assert.equal(g.status, 200);
  assert.equal(g.json.data.addOns[0].name, 'Cheese');

  const all = await waiter('GET', '/menu-items');
  assert.deepEqual(
    all.json.data.map((i) => i.name),
    ['Coffee (hot)', 'Idli', 'Masala Dosa'],
  );
  const bySnacks = await waiter('GET', `/menu-items?category=${snacks._id}`);
  assert.equal(bySnacks.json.data.length, 2);
  const paren = await waiter('GET', `/menu-items?search=${encodeURIComponent('E (H')}`);
  assert.deepEqual(
    paren.json.data.map((i) => i.name),
    ['Coffee (hot)'],
  );
  const dot = await waiter('GET', '/menu-items?search=.*');
  assert.equal(dot.json.data.length, 0); // regex chars are literal
  const avail = await waiter('GET', '/menu-items?available=true');
  assert.ok(avail.json.data.every((i) => i.isAvailable));
  assert.equal(avail.json.data.length, 2);
  assert.equal((await waiter('GET', '/menu-items?category=nope')).status, 422);
});

test('validation: category, money, url, id', async () => {
  const missing = await admin(
    'POST',
    '/menu-items',
    item({ categoryId: '0123456789abcdef01234567' }),
  );
  assert.equal(missing.status, 422);
  assert.equal((await admin('POST', '/menu-items', item({ price: 80.5 }))).status, 422);
  assert.equal((await admin('POST', '/menu-items', item({ price: '8000' }))).status, 422);
  assert.equal((await admin('POST', '/menu-items', item({ price: -1 }))).status, 422);
  assert.equal(
    (await admin('POST', '/menu-items', item({ addOns: [{ name: 'X', price: 1.5 }] }))).status,
    422,
  );
  assert.equal(
    (await admin('POST', '/menu-items', item({ imageUrl: 'http://x.com/a.png' }))).status,
    422,
  );
  assert.equal(
    (await admin('POST', '/menu-items', item({ name: 'Img', imageUrl: '' }))).status,
    201,
  );
  assert.equal((await admin('GET', '/menu-items/123')).status, 422);
  assert.equal((await admin('PATCH', '/menu-items/123', { price: 1 })).status, 422);
});

test('non-admin cannot write', async () => {
  const { json } = await admin('POST', '/menu-items', item({ name: 'Vada' }));
  const id = json.data._id;
  assert.equal((await waiter('POST', '/menu-items', item())).status, 403);
  assert.equal((await waiter('PATCH', `/menu-items/${id}`, { price: 1 })).status, 403);
  assert.equal((await waiter('DELETE', `/menu-items/${id}`)).status, 403);
});

test('price and add-on changes are audited', async () => {
  const { json } = await admin('POST', '/menu-items', item({ name: 'Upma', addOns: [] }));
  const id = json.data._id;

  const p = await admin('PATCH', `/menu-items/${id}`, { price: 9000, description: 'Soft' });
  assert.equal(p.status, 200);
  assert.equal(p.json.data.price, 9000);
  const price = await AuditLog.findOne({ entityId: id, action: 'menuItem.priceChange' });
  assert.deepEqual(price.details, { from: 8000, to: 9000 });
  const upd = await AuditLog.findOne({ entityId: id, action: 'menuItem.update' });
  assert.deepEqual(upd.details.fields, ['description']);

  await admin('PATCH', `/menu-items/${id}`, { addOns: [{ name: 'Ghee', price: 1000 }] });
  const ao = await AuditLog.findOne({ entityId: id, action: 'menuItem.addOnsChange' });
  assert.deepEqual(ao.details, { before: [], after: [{ name: 'Ghee', price: 1000 }] });

  // Same price again → no new priceChange row
  await admin('PATCH', `/menu-items/${id}`, { price: 9000 });
  assert.equal(await AuditLog.countDocuments({ entityId: id, action: 'menuItem.priceChange' }), 1);

  const bad = await admin('PATCH', `/menu-items/${id}`, { categoryId: '0123456789abcdef01234567' });
  assert.equal(bad.status, 422);
});

test('soft delete hides item but keeps the document', async () => {
  const { json } = await admin('POST', '/menu-items', item({ name: 'Pongal' }));
  const id = json.data._id;
  assert.equal((await admin('DELETE', `/menu-items/${id}`)).status, 200);

  const doc = await MenuItem.findById(id);
  assert.equal(doc.isDeleted, true);
  assert.equal(doc.isAvailable, false);
  assert.ok(await AuditLog.exists({ entityId: id, action: 'menuItem.delete' }));

  const list = await admin('GET', '/menu-items?search=pongal');
  assert.equal(list.json.data.length, 0);
  assert.equal((await admin('GET', `/menu-items/${id}`)).status, 404);
  assert.equal((await admin('PATCH', `/menu-items/${id}`, { price: 1 })).status, 404);
  assert.equal((await admin('DELETE', `/menu-items/${id}`)).status, 404);
});

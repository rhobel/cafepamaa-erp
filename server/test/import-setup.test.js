import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { start, client } from './setup.js';
import { importSetup, toPaise } from '../src/scripts/import-setup.js';
import { Settings } from '../src/models/Settings.js';
import { Category } from '../src/models/Category.js';
import { MenuItem } from '../src/models/MenuItem.js';
import { Table } from '../src/models/Table.js';
import { User } from '../src/models/User.js';

let ctx;
before(async () => (ctx = await start()));
after(() => ctx.stop());

const counts = async () => ({
  settings: await Settings.countDocuments(),
  categories: await Category.countDocuments(),
  menuItems: await MenuItem.countDocuments(),
  tables: await Table.countDocuments(),
  users: await User.countDocuments(),
});

const file = () => ({
  restaurant: { name: 'Test Café', gstin: '29abcde1234f1z5', gstRate: 5 },
  categories: ['Dosa', 'Beverages'],
  menuItems: [
    {
      name: 'Masala Dosa',
      category: 'dosa',
      price: '80.5',
      addOns: [{ name: 'Cheese', price: 30 }],
    },
    { name: 'Lime Soda', category: 'Beverages', price: '19.99' },
    { name: 'Coffee', category: 'Beverages', price: 30.25 },
  ],
  tables: [{ tableNumber: 't1', capacity: 4, section: 'AC Hall' }],
  users: [
    {
      name: 'Priya',
      username: 'Priya',
      role: 'cashier',
      password: 'secret123',
      maxDiscountPercent: 10,
    },
  ],
});

test('toPaise parses decimal strings without float math', () => {
  assert.equal(toPaise('80.5'), 8050);
  assert.equal(toPaise('19.99'), 1999);
  assert.equal(toPaise(0.29), 29);
  assert.equal(toPaise('100'), 10000);
  for (const bad of ['1.234', '-5', 'abc', '', '1e3', 0.1 + 0.2])
    assert.ok(Number.isNaN(toPaise(bad)));
});

test('invalid file → every error listed with its path, nothing written', async () => {
  const bad = file();
  bad.restaurant.gstin = 'NOPE';
  bad.menuItems[0].price = '80.555';
  bad.tables.push({ tableNumber: 'T1', capacity: 0 });
  bad.users[0].password = 'short';
  bad.users[0].username = 'a b';
  bad.extra = true;
  const { errors } = await importSetup(bad);
  for (const p of [
    'restaurant.gstin',
    'menuItems[0].price',
    'tables[1].capacity',
    'users[0].password',
    'users[0].username',
    '(file)',
  ]) {
    assert.ok(
      errors.some((e) => e.startsWith(p)),
      `missing error for ${p}: ${errors.join(' | ')}`,
    );
  }
  // Duplicates are reported once the rows themselves are valid.
  const dup = file();
  dup.menuItems.push({ name: 'masala dosa', category: 'Dosa', price: 1 });
  dup.users.push({ name: 'P2', username: 'priya', role: 'waiter' });
  assert.deepEqual((await importSetup(dup)).errors, [
    'menuItems[3]: Duplicate item in category',
    'users[1]: Duplicate username',
  ]);
  // Cross-checks that need the DB: unknown category, new user without password.
  const { errors: e2 } = await importSetup({
    menuItems: [{ name: 'X', category: 'Nowhere', price: 1 }],
    users: [{ name: 'N', username: 'nopass', role: 'waiter' }],
  });
  assert.equal(e2.length, 2);
  assert.match(e2[0], /category "Nowhere"/);
  assert.match(e2[1], /password is required/);
  assert.deepEqual(await counts(), {
    settings: 0,
    categories: 0,
    menuItems: 0,
    tables: 0,
    users: 0,
  });
});

test('dry run plans but writes nothing', async () => {
  const res = await importSetup(file(), { dryRun: true });
  assert.deepEqual(res.errors, []);
  assert.equal(res.summary.menuItems.created, 3);
  assert.deepEqual(await counts(), {
    settings: 0,
    categories: 0,
    menuItems: 0,
    tables: 0,
    users: 0,
  });
});

test('import creates rows in paise; re-run is all unchanged', async () => {
  const res = await importSetup(file());
  assert.deepEqual(res.errors, []);
  assert.deepEqual(await counts(), {
    settings: 1,
    categories: 2,
    menuItems: 3,
    tables: 1,
    users: 1,
  });

  const dosa = await MenuItem.findOne({ name: 'Masala Dosa' });
  assert.equal(dosa.price, 8050);
  assert.equal(dosa.addOns[0].price, 3000);
  assert.equal((await MenuItem.findOne({ name: 'Lime Soda' })).price, 1999);
  assert.equal((await MenuItem.findOne({ name: 'Coffee' })).price, 3025);
  const cat = await Category.findById(dosa.categoryId);
  assert.equal(cat.name, 'Dosa');
  assert.equal(cat.sortOrder, 0);
  assert.equal((await Settings.findById('restaurant')).gstin, '29ABCDE1234F1Z5');
  assert.equal((await Table.findOne()).tableNumber, 'T1');

  // The imported user can log in (bcrypt via setPassword; username lower-cased).
  const priya = await client(ctx.base, 'priya', 'secret123');
  assert.equal((await priya('GET', '/auth/me')).json.data.maxDiscountPercent, 10);

  const again = await importSetup(file());
  for (const [name, s] of Object.entries(again.summary)) {
    assert.deepEqual(s, { created: 0, updated: 0, unchanged: s.unchanged }, name);
  }
  assert.deepEqual(again.lines, []);
});

test('re-run updates changed fields, keeps passwords unless --reset-passwords', async () => {
  const f = file();
  f.menuItems[1].price = 25;
  f.menuItems[1].isAvailable = false;
  f.users[0].password = 'newpass123';
  const res = await importSetup(f);
  assert.equal(res.summary.menuItems.updated, 1);
  assert.equal(res.summary.users.unchanged, 1);
  const soda = await MenuItem.findOne({ name: 'Lime Soda' });
  assert.equal(soda.price, 2500);
  assert.equal(soda.isAvailable, false);
  await client(ctx.base, 'priya', 'secret123'); // old password still works

  const reset = await importSetup(f, { resetPasswords: true });
  assert.equal(reset.summary.users.updated, 1);
  await client(ctx.base, 'priya', 'newpass123');
  assert.equal(await MenuItem.countDocuments(), 3);
});

test('docs/setup-template.json is valid and imports', async () => {
  const tpl = JSON.parse(
    await readFile(new URL('../../docs/setup-template.json', import.meta.url)),
  );
  const res = await importSetup(tpl);
  assert.deepEqual(res.errors, []);
  const t = res.summary.tables;
  assert.deepEqual([t.created, t.updated], [9, 1]); // T1 existed from the earlier test (capacity 4 → 2)
  // "Masala Dosa" in "Dosa" matched the earlier row (price updated), so one fewer new item.
  assert.equal(await MenuItem.countDocuments(), 3 + tpl.menuItems.length - 1);
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, makeUser, client } from './setup.js';
import { AuditLog } from '../src/models/AuditLog.js';

let ctx, admin, cashier, waiter;
before(async () => {
  ctx = await start();
  await makeUser({ username: 'admin', role: 'admin' });
  await makeUser({ username: 'cashier', role: 'cashier' });
  await makeUser({ username: 'waiter', role: 'waiter' });
  [admin, cashier, waiter] = await Promise.all(
    ['admin', 'cashier', 'waiter'].map((u) => client(ctx.base, u)),
  );
});
after(() => ctx.stop());

const valid = {
  name: 'PAMAA Cafe',
  address: '12 MG Road, Bengaluru',
  phone: '+91 98765 43210',
  gstin: '29abcde1234f1z5',
  logoUrl: '',
  gstRate: 5,
  pricesIncludeTax: false,
  invoicePrefix: 'inv',
  invoiceStartNumber: 1,
  invoiceFooter: 'Thank you · Visit again',
  printFormat: '80mm',
};

test('GET returns defaults for any signed-in role', async () => {
  for (const c of [admin, cashier, waiter]) {
    const { status, json } = await c('GET', '/settings');
    assert.equal(status, 200);
    assert.equal(json.data.name, 'PAMAA');
    assert.equal(json.data.gstRate, 5);
    assert.equal(json.data.printFormat, '80mm');
  }
});

test('non-admins cannot PUT', async () => {
  for (const c of [cashier, waiter]) {
    assert.equal((await c('PUT', '/settings', valid)).status, 403);
  }
});

test('admin PUT saves, uppercases, strips unknown keys, audits only changes', async () => {
  const { status, json } = await admin('PUT', '/settings', { ...valid, hacker: 1 });
  assert.equal(status, 200);
  assert.equal(json.data.gstin, '29ABCDE1234F1Z5');
  assert.equal(json.data.invoicePrefix, 'INV');
  assert.equal(json.data.hacker, undefined);

  const log = await AuditLog.findOne({ action: 'settings.update' }).lean();
  assert.deepEqual(Object.keys(log.details).sort(), ['address', 'gstin', 'name', 'phone']);
  assert.deepEqual(log.details.name, { from: 'PAMAA', to: 'PAMAA Cafe' });

  // No-op save → no new audit row
  await admin('PUT', '/settings', valid);
  assert.equal(await AuditLog.countDocuments({ action: 'settings.update' }), 1);

  const after = await waiter('GET', '/settings');
  assert.equal(after.json.data.name, 'PAMAA Cafe');
});

test('invalid input → 422 with field path', async () => {
  for (const [field, value] of [
    ['gstin', '29ABCDE1234F1X5'],
    ['invoicePrefix', 'INV/'],
    ['invoicePrefix', 'TOOLONGPREFIX'],
    ['gstRate', 30],
    ['gstRate', 5.555],
    ['logoUrl', 'http://x.com/a.png'],
    ['printFormat', 'A5'],
    ['invoiceStartNumber', 0],
  ]) {
    const { status, json } = await admin('PUT', '/settings', { ...valid, [field]: value });
    assert.equal(status, 422, `${field}=${value}`);
    assert.equal(json.data[0].path, field);
  }
});

test('uploads/sign: waiter 403, admin 503 when Cloudinary not configured', async () => {
  assert.equal((await waiter('POST', '/uploads/sign')).status, 403);
  const { status, json } = await admin('POST', '/uploads/sign');
  assert.equal(status, 503);
  assert.match(json.message, /not configured/);
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, makeUser, client } from './setup.js';
import { AuditLog } from '../src/models/AuditLog.js';

let ctx, admin, adminId;
before(async () => {
  ctx = await start();
  adminId = (await makeUser({ username: 'admin', role: 'admin' }))._id.toString();
  await makeUser({ username: 'waiter', role: 'waiter' });
  await makeUser({ username: 'cashier', role: 'cashier' });
  admin = await client(ctx.base, 'admin');
});
after(() => ctx.stop());

const login = async (username, password = 'secret123') => {
  const res = await fetch(ctx.base + '/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return { status: res.status, cookie: res.headers.get('set-cookie')?.split(';')[0] };
};
const refresh = (cookie) =>
  fetch(ctx.base + '/auth/refresh', { method: 'POST', headers: { cookie } }).then((r) => r.status);

const noSecrets = (u) => {
  assert.equal(u.passwordHash, undefined);
  assert.equal(u.tokenVersion, undefined);
};

test('create, list (search/filter/sort), update', async () => {
  const c = await admin('POST', '/users', {
    name: 'Zara Cash',
    username: ' Zara ',
    password: 'longpass1',
    role: 'cashier',
    maxDiscountPercent: 10,
  });
  assert.equal(c.status, 201);
  assert.equal(c.json.data.username, 'zara');
  assert.equal(c.json.data.maxDiscountPercent, 10);
  noSecrets(c.json.data);
  assert.equal((await login('zara', 'longpass1')).status, 200);

  const all = await admin('GET', '/users');
  assert.equal(all.status, 200);
  const names = all.json.data.map((u) => u.name);
  assert.deepEqual(names, [...names].sort());
  all.json.data.forEach(noSecrets);

  const q = await admin('GET', '/users?q=zar');
  assert.deepEqual(
    q.json.data.map((u) => u.username),
    ['zara'],
  );
  const r = await admin('GET', '/users?role=waiter');
  assert.deepEqual(
    r.json.data.map((u) => u.username),
    ['waiter'],
  );
  assert.equal((await admin('GET', '/users?role=chef')).status, 422);

  const id = c.json.data._id;
  const u = await admin('PATCH', `/users/${id}`, { name: 'Zara C', maxDiscountPercent: 15 });
  assert.equal(u.status, 200);
  assert.equal(u.json.data.name, 'Zara C');
  assert.equal(u.json.data.maxDiscountPercent, 15);
  noSecrets(u.json.data);

  const log = await AuditLog.findOne({ action: 'user.update', entityId: id }).lean();
  assert.deepEqual(log.details, {
    name: { from: 'Zara Cash', to: 'Zara C' },
    maxDiscountPercent: { from: 10, to: 15 },
  });
  assert.ok(await AuditLog.exists({ action: 'user.create', entityId: id }));
});

test('validation: short password, bad discount, username immutable, bad/unknown id', async () => {
  const base = { name: 'X', username: 'xuser', role: 'waiter' };
  assert.equal((await admin('POST', '/users', { ...base, password: 'short' })).status, 422);
  assert.equal(
    (await admin('POST', '/users', { ...base, password: 'longpass1', maxDiscountPercent: 101 }))
      .status,
    422,
  );
  const w = (await admin('GET', '/users?q=waiter')).json.data[0];
  const imm = await admin('PATCH', `/users/${w._id}`, { username: 'other' });
  assert.equal(imm.status, 422);
  assert.equal(imm.json.message, 'Username cannot be changed');
  assert.equal((await admin('PATCH', '/users/nope', { name: 'a' })).status, 422);
  assert.equal(
    (await admin('PATCH', '/users/0123456789abcdef01234567', { name: 'a' })).status,
    404,
  );
});

test('duplicate username is 409', async () => {
  const res = await admin('POST', '/users', {
    name: 'Dup',
    username: 'WAITER',
    password: 'longpass1',
    role: 'waiter',
  });
  assert.equal(res.status, 409);
  assert.equal(res.json.message, 'Username already exists');
});

test('waiter and cashier get 403 on every route; anonymous gets 401', async () => {
  const id = adminId;
  for (const name of ['waiter', 'cashier']) {
    const c = await client(ctx.base, name);
    assert.equal((await c('GET', '/users')).status, 403);
    assert.equal(
      (
        await c('POST', '/users', {
          name: 'a',
          username: 'abc',
          password: 'x'.repeat(8),
          role: 'admin',
        })
      ).status,
      403,
    );
    assert.equal((await c('PATCH', `/users/${id}`, { role: 'waiter' })).status, 403);
  }
  assert.equal((await fetch(ctx.base + '/users')).status, 401);
});

test('admin cannot deactivate self or change own role', async () => {
  const a = await admin('PATCH', `/users/${adminId}`, { isActive: false });
  assert.equal(a.status, 409);
  assert.match(a.json.message, /own account/);
  const b = await admin('PATCH', `/users/${adminId}`, { role: 'waiter' });
  assert.equal(b.status, 409);
  assert.match(b.json.message, /own role/);
  assert.equal((await admin('PATCH', `/users/${adminId}`, { name: 'Boss' })).status, 200);
});

test('deactivation revokes refresh tokens; activation audited', async () => {
  const c = await admin('POST', '/users', {
    name: 'Deac',
    username: 'deac',
    password: 'longpass1',
    role: 'waiter',
  });
  const id = c.json.data._id;
  const { cookie } = await login('deac', 'longpass1');
  assert.equal(await refresh(cookie), 200);
  const { cookie: cookie2 } = await login('deac', 'longpass1');

  const d = await admin('PATCH', `/users/${id}`, { isActive: false });
  assert.equal(d.status, 200);
  assert.equal(d.json.data.isActive, false);
  assert.equal(await refresh(cookie2), 401);
  assert.equal((await login('deac', 'longpass1')).status, 401);

  await admin('PATCH', `/users/${id}`, { isActive: true });
  assert.equal(await refresh(cookie2), 401); // still revoked after reactivation
  assert.equal((await login('deac', 'longpass1')).status, 200);
  assert.ok(await AuditLog.exists({ action: 'user.deactivate', entityId: id }));
  assert.ok(await AuditLog.exists({ action: 'user.activate', entityId: id }));
});

test('password reset revokes refresh tokens and never logs the password', async () => {
  const c = await admin('POST', '/users', {
    name: 'Reset',
    username: 'reset',
    password: 'longpass1',
    role: 'cashier',
  });
  const id = c.json.data._id;
  const { cookie } = await login('reset', 'longpass1');

  const r = await admin('PATCH', `/users/${id}`, { password: 'newpass99' });
  assert.equal(r.status, 200);
  noSecrets(r.json.data);
  assert.equal(await refresh(cookie), 401);
  assert.equal((await login('reset', 'longpass1')).status, 401);
  assert.equal((await login('reset', 'newpass99')).status, 200);
  assert.ok(await AuditLog.exists({ action: 'user.passwordReset', entityId: id }));

  const logs = JSON.stringify(await AuditLog.find({ entityId: id }).lean());
  assert.doesNotMatch(logs, /longpass1|newpass99|passwordHash|\$2[aby]\$/);
});

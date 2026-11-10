import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './setup.js';
import { User } from '../src/models/User.js';
import { auth, requireRole } from '../src/middleware/auth.js';

let ctx;
before(async () => {
  ctx = await start();
  for (const [username, role] of [
    ['admin', 'admin'],
    ['waiter', 'waiter'],
  ]) {
    const u = new User({ name: username, username, role });
    await u.setPassword('secret123');
    await u.save();
  }
  const off = new User({ name: 'Off', username: 'off', role: 'cashier', isActive: false });
  await off.setPassword('secret123');
  await off.save();
});
after(() => ctx.stop());

const post = (path, body, headers = {}) =>
  fetch(ctx.base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body && JSON.stringify(body),
  });

const login = async (username, password = 'secret123') => {
  const res = await post('/auth/login', { username, password });
  return { res, json: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
};

test('login returns token + user without secrets, sets httpOnly refresh cookie', async () => {
  const { res, json } = await login('Admin '); // trimmed + lowercased
  assert.equal(res.status, 200);
  assert.equal(json.success, true);
  assert.ok(json.data.accessToken);
  assert.equal(json.data.user.role, 'admin');
  assert.equal(json.data.user.passwordHash, undefined);
  assert.equal(json.data.user.tokenVersion, undefined);
  assert.match(res.headers.get('set-cookie'), /rt=.+HttpOnly/i);
});

test('bad password, unknown user and inactive user all get 401', async () => {
  for (const [u, p] of [
    ['admin', 'wrong'],
    ['nobody', 'secret123'],
    ['off', 'secret123'],
  ]) {
    const { res, json } = await login(u, p);
    assert.equal(res.status, 401);
    assert.deepEqual(json, { success: false, data: null, message: 'Invalid username or password' });
  }
});

test('validation error is 422 in the standard shape', async () => {
  const res = await post('/auth/login', { username: '' });
  assert.equal(res.status, 422);
  assert.equal((await res.json()).success, false);
});

test('/me needs a valid access token', async () => {
  assert.equal((await fetch(ctx.base + '/auth/me')).status, 401);
  const { json } = await login('waiter');
  const res = await fetch(ctx.base + '/auth/me', {
    headers: { authorization: `Bearer ${json.data.accessToken}` },
  });
  assert.equal((await res.json()).data.username, 'waiter');
});

test('refresh works until logout, then the old cookie is revoked', async () => {
  const { cookie } = await login('waiter');
  const r1 = await post('/auth/refresh', null, { cookie });
  assert.equal(r1.status, 200);
  assert.ok((await r1.json()).data.accessToken);

  assert.equal((await post('/auth/logout', null, { cookie })).status, 200);
  assert.equal((await post('/auth/refresh', null, { cookie })).status, 401);
  assert.equal((await post('/auth/refresh')).status, 401);
});

test('deactivating a user kills their access token immediately', async () => {
  const { json } = await login('admin');
  await User.updateOne({ username: 'admin' }, { isActive: false });
  const res = await fetch(ctx.base + '/auth/me', {
    headers: { authorization: `Bearer ${json.data.accessToken}` },
  });
  assert.equal(res.status, 401);
  await User.updateOne({ username: 'admin' }, { isActive: true });
});

test('requireRole: 403 for wrong role, passes for allowed role', async () => {
  const { json } = await login('waiter');
  const req = { headers: { authorization: `Bearer ${json.data.accessToken}` } };
  await auth(req, {}, () => {});
  assert.throws(() => requireRole('admin', 'cashier')(req, {}, () => {}), { status: 403 });
  let passed = false;
  requireRole('waiter')(req, {}, () => (passed = true));
  assert.ok(passed);
});

test('unknown route is 404 in the standard shape', async () => {
  const res = await fetch(ctx.base + '/nope');
  assert.equal(res.status, 404);
  assert.equal((await res.json()).success, false);
});

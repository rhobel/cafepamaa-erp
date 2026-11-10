// S6-2 security pass: auth on every route, role matrix (requirement §3), auth hardening, mass assignment.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { start, makeUser, client } from './setup.js';
import { createApp, API_ROUTERS } from '../src/app.js';
import { Invoice } from '../src/models/Invoice.js';
import { Table } from '../src/models/Table.js';
import { User } from '../src/models/User.js';

const PUBLIC = new Set([
  'POST /api/auth/login',
  'POST /api/auth/refresh',
  'POST /api/auth/logout',
  'GET /api/health',
]);
const ID = '0123456789abcdef01234567';

/** Every [method, fullPath] the app serves, read from the routers themselves. */
function allRoutes() {
  const routes = [];
  const add = (prefix, layer) => {
    for (const m of Object.keys(layer.route.methods)) {
      routes.push([m.toUpperCase(), prefix + (layer.route.path === '/' ? '' : layer.route.path)]);
    }
  };
  for (const [prefix, router] of API_ROUTERS) {
    for (const layer of router.stack) {
      if (layer.route) add(prefix, layer);
      assert.ok(!layer.handle.stack, `nested router under ${prefix}: extend allRoutes()`);
    }
  }
  const appStack = createApp().router.stack;
  for (const layer of appStack) if (layer.route) add('', layer);
  // A router mounted outside API_ROUTERS would escape this test.
  assert.equal(appStack.filter((l) => l.handle.stack).length, API_ROUTERS.length);
  return routes;
}

let ctx, admin, waiter, cashier, cashierUser, otherCashier;
const as = {};
before(async () => {
  ctx = await start();
  await makeUser({ username: 'admin', role: 'admin' });
  await makeUser({ username: 'waiter', role: 'waiter' });
  cashierUser = await makeUser({ username: 'cashier', role: 'cashier', maxDiscountPercent: 10 });
  otherCashier = await makeUser({ username: 'cashier2', role: 'cashier' });
  [admin, waiter, cashier] = await Promise.all(
    ['admin', 'waiter', 'cashier'].map((u) => client(ctx.base, u)),
  );
  Object.assign(as, { admin, waiter, cashier });
});
after(() => ctx.stop());

test('every non-public /api route returns 401 without a token', async () => {
  const routes = allRoutes();
  assert.ok(routes.length > 40, `only ${routes.length} routes found`);
  for (const p of PUBLIC)
    assert.ok(
      routes.some(([m, u]) => `${m} ${u}` === p),
      `${p} missing`,
    );
  for (const [method, path] of routes) {
    if (PUBLIC.has(`${method} ${path}`)) continue;
    const url = path
      .replace(/^\/api/, '')
      .replace(/:type/g, 'sales')
      .replace(/:\w+/g, ID);
    const res = await fetch(ctx.base + url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : '{}',
    });
    assert.equal(res.status, 401, `${method} ${path} → ${res.status}`);
  }
});

test('forged tokens are rejected: alg none, wrong secret, stale tokenVersion', async () => {
  const user = await User.findOne({ username: 'admin' }).select('+tokenVersion');
  const me = (token) =>
    fetch(ctx.base + '/auth/me', { headers: { authorization: `Bearer ${token}` } });
  const claims = { sub: user.id, role: 'admin', v: user.tokenVersion };
  assert.equal((await me(jwt.sign(claims, null, { algorithm: 'none' }))).status, 401);
  assert.equal((await me(jwt.sign(claims, 'x'.repeat(40)))).status, 401);
  const good = jwt.sign(claims, process.env.JWT_SECRET);
  assert.equal((await me(good)).status, 200);
  assert.equal((await me(jwt.sign({ ...claims, v: 99 }, process.env.JWT_SECRET))).status, 401);
});

// [method, path, body, roles allowed] — one representative endpoint per capability in requirement §3.
const MATRIX = [
  ['GET', '/customers/search', undefined, 'admin waiter cashier'],
  ['GET', '/settings', undefined, 'admin waiter cashier'],
  ['GET', '/menu-items', undefined, 'admin waiter cashier'],
  ['GET', '/tables', undefined, 'admin waiter cashier'],
  ['GET', '/bills', undefined, 'admin waiter cashier'],
  ['POST', '/bills/orders', {}, 'admin waiter'],
  ['POST', `/bills/${ID}/checkout`, undefined, 'admin cashier'],
  ['POST', `/bills/${ID}/cancel-checkout`, undefined, 'admin cashier'],
  ['POST', `/bills/${ID}/calculate`, {}, 'admin cashier'],
  ['POST', `/bills/${ID}/invoice`, {}, 'admin cashier'],
  ['PATCH', `/bills/${ID}/items/${ID}/void`, {}, 'admin'],
  ['POST', `/bills/${ID}/cancel`, {}, 'admin'],
  ['GET', '/invoices', undefined, 'admin cashier'],
  ['GET', `/invoices/${ID}`, undefined, 'admin cashier'],
  ['POST', `/invoices/${ID}/reprint`, undefined, 'admin cashier'],
  ['GET', '/dashboard/summary', undefined, 'admin cashier'],
  ['GET', '/reports/sales', undefined, 'admin cashier'],
  ['GET', '/users', undefined, 'admin'],
  ['POST', '/users', {}, 'admin'],
  ['PATCH', `/users/${ID}`, {}, 'admin'],
  ['PUT', '/settings', {}, 'admin'],
  ['POST', '/menu-items', {}, 'admin'],
  ['PATCH', `/menu-items/${ID}`, {}, 'admin'],
  ['DELETE', `/menu-items/${ID}`, undefined, 'admin'],
  ['POST', '/categories', {}, 'admin'],
  ['POST', '/categories/reorder', {}, 'admin'],
  ['PATCH', `/categories/${ID}`, {}, 'admin'],
  ['DELETE', `/categories/${ID}`, undefined, 'admin'],
  ['POST', '/tables', {}, 'admin'],
  ['PATCH', `/tables/${ID}`, {}, 'admin'],
  ['POST', '/uploads/sign', undefined, 'admin'],
];

test('role matrix (requirement §3): forbidden roles get 403, allowed roles get past the role check', async () => {
  for (const [method, path, body, allowed] of MATRIX) {
    for (const role of ['admin', 'waiter', 'cashier']) {
      const { status } = await as[role](method, path, body);
      if (allowed.includes(role)) {
        // Past the role check: 2xx, or a validation/404/503 from the handler itself.
        assert.ok(![401, 403].includes(status), `${role} ${method} ${path} → ${status}`);
        if (method === 'GET' && !path.includes(ID)) assert.equal(status, 200, `${role} ${path}`);
      } else {
        assert.equal(status, 403, `${role} ${method} ${path} → ${status} (want 403)`);
      }
    }
  }
});

test('cashier reports are limited to their own invoices today, whatever they ask for', async () => {
  let n = 0;
  const inv = (cashierId, grandTotal, createdAt = new Date()) =>
    Invoice.create({
      invoiceNumber: `SEC/${++n}`,
      billId: new mongoose.Types.ObjectId(),
      billNumber: `RB-S${n}`,
      idempotencyKey: `sec-${n}`,
      tableNumber: 'T1',
      items: [{ name: 'Tea', qty: 1, rate: grandTotal, amount: grandTotal }],
      subtotal: grandTotal,
      taxableAmount: grandTotal,
      gstRate: 0,
      cgst: 0,
      sgst: 0,
      roundOff: 0,
      grandTotal,
      payments: [{ method: 'cash', amount: grandTotal }],
      cashierId,
      cashierName: 'x',
      createdAt,
    });
  await inv(cashierUser._id, 1000);
  await inv(cashierUser._id, 5000, new Date(Date.now() - 3 * 86400000)); // not today
  await inv(otherCashier._id, 7000);

  const q = `?from=2000-01-01&to=2999-12-31&cashier=${otherCashier._id}`;
  const own = await cashier('GET', `/reports/sales${q}`);
  assert.equal(own.status, 200);
  assert.equal(own.json.data.totals.grandTotal, 1000);
  const all = await admin('GET', '/reports/sales');
  assert.equal(all.json.data.totals.grandTotal, 8000);
});

test('mass assignment: protected fields in bodies are ignored', async () => {
  const u = await admin('POST', '/users', {
    name: 'New',
    username: 'newbie',
    password: 'longenough',
    role: 'waiter',
    isActive: false,
    tokenVersion: 42,
    passwordHash: 'x',
  });
  assert.equal(u.status, 201);
  const saved = await User.findById(u.json.data._id).select('+tokenVersion +passwordHash');
  assert.equal(saved.isActive, true);
  assert.equal(saved.tokenVersion, 0);
  assert.notEqual(saved.passwordHash, 'x');

  const t = await admin('POST', '/tables', {
    tableNumber: 'S1',
    capacity: 2,
    status: 'occupied',
    currentBillId: ID,
  });
  assert.equal(t.status, 201);
  const table = await Table.findById(t.json.data._id);
  assert.equal(table.status, 'available');
  assert.equal(table.currentBillId, null);
});

test('NoSQL operator injection in query/body is rejected by validation', async () => {
  const r1 = await admin('GET', '/customers?mobile[$ne]=x');
  assert.equal(r1.status, 422);
  const r2 = await fetch(ctx.base + '/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: { $ne: null }, password: { $ne: null } }),
  });
  assert.equal(r2.status, 422);
});

test('login: same answer for unknown user and wrong password; short new passwords rejected', async () => {
  const login = (username, password) =>
    fetch(ctx.base + '/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }).then(async (r) => ({ status: r.status, message: (await r.json()).message }));
  const unknown = await login('nobody', 'secret123');
  const wrong = await login('admin', 'wrong-password');
  assert.deepEqual(unknown, wrong);
  assert.equal(unknown.status, 401);

  const short = await admin('POST', '/users', {
    name: 'S',
    username: 'shorty',
    password: 'short',
    role: 'waiter',
  });
  assert.equal(short.status, 422);
});

test('password reset revokes the old access token immediately', async () => {
  const target = await makeUser({ username: 'resetme', role: 'waiter' });
  const victim = await client(ctx.base, 'resetme');
  assert.equal((await victim('GET', '/auth/me')).status, 200);
  await admin('PATCH', `/users/${target._id}`, { password: 'brand-new-pass' });
  assert.equal((await victim('GET', '/auth/me')).status, 401);
});

test('headers: no x-powered-by, helmet on, CORS only for the client origin; big body → 413', async () => {
  const ok = await fetch(ctx.base + '/health', { headers: { origin: process.env.CLIENT_URL } });
  assert.equal(ok.headers.get('x-powered-by'), null);
  assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
  const csp = ok.headers.get('content-security-policy');
  assert.match(csp, /img-src 'self' data: https:/);
  assert.match(csp, /script-src 'self'/); // rest of Helmet's defaults kept
  assert.equal(ok.headers.get('ratelimit'), null, '/api/health is outside the global limiter');
  const limited = await fetch(ctx.base + '/settings');
  assert.ok(limited.headers.get('ratelimit'), 'other /api routes are rate limited');
  assert.equal(ok.headers.get('access-control-allow-origin'), process.env.CLIENT_URL);
  assert.equal(ok.headers.get('access-control-allow-credentials'), 'true');
  const evil = await fetch(ctx.base + '/health', { headers: { origin: 'https://evil.example' } });
  // cors() always answers with the one allowed origin; the browser then blocks evil.example.
  assert.equal(evil.headers.get('access-control-allow-origin'), process.env.CLIENT_URL);

  const big = await fetch(ctx.base + '/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'a', password: 'x'.repeat(200_000) }),
  });
  assert.equal(big.status, 413);
  assert.equal((await big.json()).message, 'Request body too large');
});

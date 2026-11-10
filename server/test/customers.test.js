import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, makeUser, client } from './setup.js';

let ctx, waiter;
before(async () => {
  ctx = await start();
  await makeUser({ username: 'waiter', role: 'waiter' });
  waiter = await client(ctx.base, 'waiter');
});
after(() => ctx.stop());

test('mobile validation → 422', async () => {
  for (const m of ['12345', '5876543210', '98765432101', 'abcdefghij']) {
    assert.equal((await waiter('GET', `/customers?mobile=${m}`)).status, 422);
    assert.equal((await waiter('POST', '/customers', { mobile: m })).status, 422);
  }
});

test('lookup unknown, register without name, duplicate → 409', async () => {
  const miss = await waiter('GET', '/customers?mobile=9876543210');
  assert.equal(miss.status, 200);
  assert.deepEqual(miss.json.data, { customer: null, activeBill: null });

  const c = await waiter('POST', '/customers', { mobile: '9876543210' });
  assert.equal(c.status, 201);
  assert.equal(c.json.data.name, '');
  assert.equal(c.json.data.totalVisits, 0);
  assert.equal(c.json.data.totalSpent, 0);
  assert.equal(c.json.data.lastVisitAt, null);

  const hit = await waiter('GET', '/customers?mobile=9876543210');
  assert.equal(hit.json.data.customer._id, c.json.data._id);
  assert.equal(hit.json.data.activeBill, null);

  const dup = await waiter('POST', '/customers', { mobile: '9876543210', name: 'Asha' });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.message, 'Customer already exists');

  const named = await waiter('POST', '/customers', { mobile: '7000000001', name: '  Ravi ' });
  assert.equal(named.json.data.name, 'Ravi');
});

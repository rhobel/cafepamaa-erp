import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './setup.js';
import {
  financialYear,
  nextBillNumber,
  nextInvoiceNumber,
  nextSeq,
} from '../src/services/counters.js';

let ctx;
before(async () => (ctx = await start()));
after(() => ctx.stop());

test('financialYear switches on 1 April IST, not UTC', () => {
  assert.equal(financialYear(new Date('2026-11-10T12:00:00Z')), '2026-27');
  assert.equal(financialYear(new Date('2027-03-31T18:00:00Z')), '2026-27'); // 23:30 IST 31 Mar
  assert.equal(financialYear(new Date('2027-03-31T18:30:00Z')), '2027-28'); // 00:00 IST 1 Apr
  assert.equal(financialYear(new Date('2099-06-01T00:00:00Z')), '2099-00');
});

test('nextSeq is atomic under concurrency', async () => {
  const values = await Promise.all(Array.from({ length: 50 }, () => nextSeq('race')));
  assert.deepEqual(
    values.sort((a, b) => a - b),
    Array.from({ length: 50 }, (_, i) => i + 1),
  );
});

test('number formats and FY reset', async () => {
  assert.equal(await nextBillNumber(), 'RB-0001');
  const march = new Date('2027-03-31T10:00:00Z');
  const april = new Date('2027-04-01T10:00:00Z');
  assert.equal(await nextInvoiceNumber('INV', { date: march }), 'INV/2026-27/00001');
  assert.equal(await nextInvoiceNumber('INV', { date: march }), 'INV/2026-27/00002');
  assert.equal(await nextInvoiceNumber('INV', { date: april }), 'INV/2027-28/00001');
});

test('invoice startNumber is a floor, never reuses numbers', async () => {
  const d = new Date('2030-06-01T10:00:00Z'); // fresh FY 2030-31
  assert.equal(await nextInvoiceNumber('INV', { date: d, startNumber: 500 }), 'INV/2030-31/00500');
  assert.equal(await nextInvoiceNumber('INV', { date: d, startNumber: 500 }), 'INV/2030-31/00501');
  assert.equal(await nextInvoiceNumber('INV', { date: d, startNumber: 1 }), 'INV/2030-31/00502');
  assert.equal(await nextInvoiceNumber('INV', { date: d, startNumber: 900 }), 'INV/2030-31/00900');
});

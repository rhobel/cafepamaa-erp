import { Counter } from '../models/Counter.js';

const IST_OFFSET_MS = 330 * 60 * 1000;

/** Atomically returns the next value of a named sequence. Pass `session` inside a transaction. */
export async function nextSeq(name, { session } = {}) {
  const doc = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after', session },
  );
  return doc.seq;
}

/** Indian financial year (1 Apr – 31 Mar, IST) for a date, e.g. "2026-27". */
export function financialYear(date = new Date()) {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

const pad = (n, width) => String(n).padStart(width, '0');

export const nextBillNumber = async (opts) => `RB-${pad(await nextSeq('bill', opts), 4)}`;

export const nextOrderNumber = async (opts) => `ORD-${pad(await nextSeq('order', opts), 4)}`;

/**
 * e.g. INV/2026-27/00001. The counter resets each financial year because the key includes the FY.
 * `startNumber` (Settings.invoiceStartNumber) is a floor: the next number is max(last, startNumber − 1) + 1,
 * so raising it jumps ahead, lowering it never reuses numbers.
 */
export async function nextInvoiceNumber(
  prefix = 'INV',
  { date = new Date(), session, startNumber = 1 } = {},
) {
  const fy = financialYear(date);
  const doc = await Counter.findOneAndUpdate(
    { _id: `invoice-${fy}` },
    [{ $set: { seq: { $add: [{ $max: [{ $ifNull: ['$seq', 0] }, startNumber - 1] }, 1] } } }],
    { upsert: true, returnDocument: 'after', session, updatePipeline: true },
  );
  return `${prefix}/${fy}/${pad(doc.seq, 5)}`;
}

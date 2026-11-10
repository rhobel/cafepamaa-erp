import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { RunningBill, ACTIVE_BILL } from '../models/RunningBill.js';
import { Table } from '../models/Table.js';
import { getSettings } from '../models/Settings.js';
import { auth, requireRole } from '../middleware/auth.js';
import { validate, idParams } from '../middleware/validate.js';
import { HttpError, ok } from '../utils/http.js';
import { calculateBill } from '../services/billing.js';
import { audit } from '../services/audit.js';

// Sprint 3: checkout, discount calculation, item void, bill cancel. Mounted at /api/bills.
export const checkoutRouter = Router();
checkoutRouter.use(auth);

const cashierOrAdmin = requireRole('admin', 'cashier');
const adminOnly = requireRole('admin');
const reasonBody = z.object({ reason: z.string().trim().min(3).max(200) });
const itemParams = idParams.extend({
  itemId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id'),
});
const calcBody = z.object({
  discount: z
    .discriminatedUnion('type', [
      z.object({ type: z.literal('percent'), value: z.number().min(0).max(100) }),
      z.object({ type: z.literal('flat'), value: z.number().int().min(0) }),
    ])
    .nullable()
    .default(null),
});

const TABLE_FOR = { open: 'occupied', billing: 'billing' };
const notFound = () => new HttpError(404, 'Bill not found');
const closedError = (bill) => new HttpError(409, `Bill ${bill.billNumber} is ${bill.status}`);
const sumLive = (bill) =>
  bill.rounds
    .flatMap((r) => r.items.filter((i) => !i.isVoided))
    .reduce((s, i) => s + i.lineTotal, 0);

async function calc(subtotal, discount = null) {
  const { gstRate, pricesIncludeTax } = await getSettings();
  return calculateBill({ subtotal, discount, gstRate, pricesIncludeTax });
}

/** Moves bill + table between open/occupied and billing/billing in one transaction. Already there → no-op. */
async function move(id, from, to) {
  let bill;
  await mongoose.connection.transaction(async (session) => {
    bill = await RunningBill.findById(id, null, { session }).lean();
    if (!bill) throw notFound();
    if (bill.status === to) return;
    if (bill.status !== from) throw closedError(bill);
    const b = await RunningBill.updateOne({ _id: id, status: from }, { status: to }, { session });
    const t = await Table.updateOne(
      { _id: bill.tableId, status: TABLE_FOR[from] },
      { status: TABLE_FOR[to] },
      { session },
    );
    if (!b.modifiedCount || !t.modifiedCount)
      throw new HttpError(409, 'Bill or table changed meanwhile. Please refresh.');
    bill.status = to;
  });
  return bill;
}

checkoutRouter.post(
  '/:id/checkout',
  cashierOrAdmin,
  validate(idParams, 'params'),
  async (req, res) => {
    const bill = await move(req.params.id, 'open', 'billing');
    ok(res, { bill, calc: await calc(bill.subtotal) }, `Bill ${bill.billNumber} at checkout`);
  },
);

checkoutRouter.post(
  '/:id/cancel-checkout',
  cashierOrAdmin,
  validate(idParams, 'params'),
  async (req, res) => {
    const bill = await move(req.params.id, 'billing', 'open');
    ok(res, bill, `Bill ${bill.billNumber} back to open`);
  },
);

checkoutRouter.post(
  '/:id/calculate',
  cashierOrAdmin,
  validate(idParams, 'params'),
  validate(calcBody),
  async (req, res) => {
    const bill = await RunningBill.findById(req.params.id).lean();
    if (!bill) throw notFound();
    if (bill.status !== 'billing') throw new HttpError(409, 'Bill is not at checkout');
    const { discount } = req.body;
    if (discount && req.user.role !== 'admin') {
      const limit = req.user.maxDiscountPercent ?? 0;
      const over =
        discount.type === 'percent'
          ? discount.value > limit
          : discount.value * 100 > bill.subtotal * limit;
      if (over) throw new HttpError(403, `Discount above your limit of ${limit}%`);
    }
    ok(res, await calc(bill.subtotal, discount));
  },
);

checkoutRouter.patch(
  '/:id/items/:itemId/void',
  adminOnly,
  validate(itemParams, 'params'),
  validate(reasonBody),
  async (req, res) => {
    let bill;
    await mongoose.connection.transaction(async (session) => {
      bill = await RunningBill.findById(req.params.id, null, { session });
      if (!bill) throw notFound();
      if (!ACTIVE_BILL.includes(bill.status)) throw closedError(bill);
      const item = bill.rounds.map((r) => r.items.id(req.params.itemId)).find(Boolean);
      if (!item) throw new HttpError(404, 'Item not found on this bill');
      if (item.isVoided) throw new HttpError(409, `${item.name} is already voided`);
      item.isVoided = true;
      item.voidReason = req.body.reason;
      bill.subtotal = sumLive(bill);
      await bill.save({ session });
      const { name, qty, lineTotal } = item;
      await audit(
        req.user,
        'bill.voidItem',
        'runningBill',
        bill._id,
        { itemId: item._id, name, qty, lineTotal, reason: req.body.reason },
        { session },
      );
    });
    ok(res, bill, 'Item voided');
  },
);

checkoutRouter.post(
  '/:id/cancel',
  adminOnly,
  validate(idParams, 'params'),
  validate(reasonBody),
  async (req, res) => {
    let bill;
    await mongoose.connection.transaction(async (session) => {
      bill = await RunningBill.findById(req.params.id, null, { session });
      if (!bill) throw notFound();
      if (!ACTIVE_BILL.includes(bill.status)) throw closedError(bill);
      if (sumLive(bill) !== 0)
        throw new HttpError(409, 'Void all items before cancelling the bill');
      bill.status = 'cancelled';
      bill.closedAt = new Date();
      bill.subtotal = 0;
      await bill.save({ session });
      await Table.updateOne(
        { _id: bill.tableId, currentBillId: bill._id },
        { status: 'available', currentBillId: null },
        { session },
      );
      await audit(
        req.user,
        'bill.cancel',
        'runningBill',
        bill._id,
        { reason: req.body.reason },
        { session },
      );
    });
    ok(res, bill, `Bill ${bill.billNumber} cancelled`);
  },
);

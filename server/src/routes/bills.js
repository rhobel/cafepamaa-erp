import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { RunningBill, BILL_STATUSES, ACTIVE_BILL } from '../models/RunningBill.js';
import { Customer } from '../models/Customer.js';
import { Table } from '../models/Table.js';
import { MenuItem } from '../models/MenuItem.js';
import { auth, requireRole } from '../middleware/auth.js';
import { validate, idParams } from '../middleware/validate.js';
import { HttpError, ok } from '../utils/http.js';
import { nextBillNumber, nextOrderNumber } from '../services/counters.js';
import { audit } from '../services/audit.js';

export const billsRouter = Router();
billsRouter.use(auth);

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const listQuery = z.object({
  status: z.enum(BILL_STATUSES).optional(),
  mine: z.enum(['true', 'false']).optional(),
});
const orderSchema = z.object({
  customerId: objectId,
  tableId: objectId.optional(),
  billId: objectId.nullable(),
  items: z
    .array(
      z.object({
        menuItemId: objectId,
        qty: z.number().int().min(1).max(99),
        addOnIds: z.array(objectId).default([]),
        instructions: z.string().trim().max(200).default(''),
      }),
    )
    .min(1, 'Add at least one item'),
  idempotencyKey: z.string().min(8).max(100),
});

const sumPaise = (xs) => xs.reduce((s, x) => s + x, 0);
const takenError = (n) =>
  new HttpError(409, `Table ${n} was just taken. Please pick another table.`);

billsRouter.get('/', validate(listQuery, 'query'), async (req, res) => {
  const { status, mine } = req.validQuery;
  const filter = { status: status ?? { $in: ACTIVE_BILL } };
  if (req.user.role === 'waiter' || mine === 'true') filter['rounds.waiterId'] = req.user._id;
  const bills = await RunningBill.find(
    filter,
    'billNumber tableNumber customerName customerMobile status subtotal openedAt rounds._id',
  )
    .sort({ openedAt: -1 })
    .lean();
  ok(
    res,
    bills.map((b) => ({
      _id: b._id,
      billNumber: b.billNumber,
      tableNumber: b.tableNumber,
      customerName: b.customerName,
      customerMobile: b.customerMobile,
      status: b.status,
      subtotal: b.subtotal,
      roundCount: b.rounds.length,
      openedAt: b.openedAt,
    })),
  );
});

billsRouter.get(
  '/active-by-table/:tableId',
  validate(z.object({ tableId: objectId }), 'params'),
  async (req, res) => {
    const bill = await RunningBill.findOne({
      tableId: req.params.tableId,
      status: { $in: ACTIVE_BILL },
    }).lean();
    ok(res, bill);
  },
);

billsRouter.get('/:id', validate(idParams, 'params'), async (req, res) => {
  const bill = await RunningBill.findById(req.params.id).lean();
  if (!bill) throw new HttpError(404, 'Bill not found');
  ok(res, bill);
});

/** Opens a bill for a new table (if needed) and saves one round of items, all in one transaction. */
async function placeOrder(body, user, session) {
  const opts = { session };
  const replay = await RunningBill.findOne(
    { 'rounds.idempotencyKey': body.idempotencyKey },
    null,
    opts,
  );
  if (replay) {
    const round = replay.rounds.find((r) => r.idempotencyKey === body.idempotencyKey);
    return { bill: replay, orderNumber: round.orderNumber, replayed: true };
  }

  let bill;
  if (body.billId) {
    bill = await RunningBill.findById(body.billId, null, opts);
    if (!bill) throw new HttpError(404, 'Bill not found');
    if (bill.status === 'billing')
      throw new HttpError(409, "Bill is at checkout; new items can't be added");
    if (bill.status !== 'open') throw new HttpError(409, `Bill ${bill.billNumber} is closed`);
  } else {
    if (!body.tableId) throw new HttpError(422, 'Pick a table');
    const table = await Table.findById(body.tableId, null, opts);
    if (!table) throw new HttpError(404, 'Table not found');
    if (!table.isActive || table.status !== 'available') throw takenError(table.tableNumber);

    const customer = await Customer.findById(body.customerId, null, opts);
    if (!customer) throw new HttpError(404, 'Customer not found');
    const existing = await RunningBill.findOne(
      { customerId: customer._id, status: { $in: ACTIVE_BILL } },
      null,
      opts,
    );
    if (existing)
      throw new HttpError(
        409,
        `Customer already has an open bill ${existing.billNumber} at Table ${existing.tableNumber}`,
        { billId: existing._id },
      );

    bill = new RunningBill({
      billNumber: await nextBillNumber(opts),
      customerId: customer._id,
      customerMobile: customer.mobile,
      customerName: customer.name,
      tableId: table._id,
      tableNumber: table.tableNumber,
    });
    const taken = await Table.updateOne(
      { _id: table._id, status: 'available' },
      { status: 'occupied', currentBillId: bill._id },
      opts,
    );
    if (!taken.modifiedCount) throw takenError(table.tableNumber);
  }

  const ids = body.items.map((i) => i.menuItemId);
  const menu = await MenuItem.find({ _id: { $in: ids } }, null, opts);
  const byId = new Map(menu.map((m) => [String(m._id), m]));
  const unavailable = [...new Set(ids)].filter((id) => {
    const m = byId.get(id);
    return !m || m.isDeleted || !m.isAvailable;
  });
  if (unavailable.length) {
    const names = unavailable.map((id) => byId.get(id)?.name ?? 'An item');
    throw new HttpError(
      422,
      `${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} no longer available.`,
      { unavailable },
    );
  }

  const items = body.items.map(({ menuItemId, qty, addOnIds, instructions }) => {
    const m = byId.get(menuItemId);
    const addOns = addOnIds.map((aid) => {
      const a = m.addOns.id(aid);
      if (!a) throw new HttpError(422, `Unknown add-on for ${m.name}`);
      return { name: a.name, price: a.price };
    });
    const lineTotal = (m.price + sumPaise(addOns.map((a) => a.price))) * qty;
    return { menuItemId, name: m.name, price: m.price, qty, addOns, instructions, lineTotal };
  });

  const orderNumber = await nextOrderNumber(opts);
  bill.rounds.push({
    orderNumber,
    waiterId: user._id,
    waiterName: user.name,
    idempotencyKey: body.idempotencyKey,
    items,
  });
  bill.subtotal = sumPaise(
    bill.rounds.flatMap((r) => r.items.filter((i) => !i.isVoided).map((i) => i.lineTotal)),
  );
  try {
    await bill.save(opts);
  } catch (err) {
    if (err?.code === 11000 && err.keyPattern?.tableId) throw takenError(bill.tableNumber);
    throw err;
  }
  await audit(
    user,
    'bill.order',
    'runningBill',
    bill._id,
    { orderNumber, items: items.length },
    opts,
  );
  return { bill, orderNumber };
}

billsRouter.post(
  '/orders',
  requireRole('admin', 'waiter'),
  validate(orderSchema),
  async (req, res) => {
    let result;
    // connection.transaction retries transient write conflicts (e.g. two waiters racing for one table).
    await mongoose.connection.transaction(async (session) => {
      result = await placeOrder(req.body, req.user, session);
    });
    const { bill, orderNumber, replayed } = result;
    ok(
      res,
      { bill, orderNumber },
      `Order ${orderNumber} saved to Bill ${bill.billNumber} · Table ${bill.tableNumber}`,
      replayed ? 200 : 201,
    );
  },
);

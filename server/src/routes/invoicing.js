import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { RunningBill } from '../models/RunningBill.js';
import { Table } from '../models/Table.js';
import { Customer } from '../models/Customer.js';
import { Invoice } from '../models/Invoice.js';
import { getSettings } from '../models/Settings.js';
import { auth, requireRole } from '../middleware/auth.js';
import { validate, idParams } from '../middleware/validate.js';
import { HttpError, ok } from '../utils/http.js';
import { calculateBill } from '../services/billing.js';
import { nextInvoiceNumber } from '../services/counters.js';
import { audit } from '../services/audit.js';

// Sprint 4: POST /bills/:id/invoice — bill at checkout → paid, locked invoice. Mounted at /api/bills.
export const invoicingRouter = Router();

const paise = z.number().int().min(1);
const invoiceBody = z.object({
  discount: z
    .discriminatedUnion('type', [
      z.object({ type: z.literal('percent'), value: z.number().min(0).max(100) }),
      z.object({ type: z.literal('flat'), value: z.number().int().min(0) }),
    ])
    .nullable()
    .default(null),
  payments: z
    .array(
      z.discriminatedUnion('method', [
        z
          .object({ method: z.literal('cash'), amount: paise, tendered: paise.optional() })
          .refine((p) => p.tendered === undefined || p.tendered >= p.amount, {
            message: 'Cash tendered cannot be less than the amount',
            path: ['tendered'],
          }),
        z.object({
          method: z.enum(['upi', 'card']),
          amount: paise,
          reference: z.string().trim().max(60).optional(),
        }),
      ]),
    )
    .min(0) // empty only valid when grandTotal is 0 (sum check below)
    .max(5),
  idempotencyKey: z.string().min(8).max(100),
});

const rupees = (p) =>
  `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const alreadyInvoiced = () => new HttpError(409, 'Invoice already generated for this bill');

/** Non-voided bill items, identical lines (name + unit price + add-on set) merged across rounds. */
function invoiceItems(bill) {
  const lines = new Map();
  for (const i of bill.rounds.flatMap((r) => r.items.filter((x) => !x.isVoided))) {
    const addOns = i.addOns.map(({ name, price }) => ({ name, price }));
    const key = JSON.stringify([i.name, i.price, addOns.map((a) => `${a.name}:${a.price}`).sort()]);
    const line = lines.get(key);
    if (line) line.qty += i.qty;
    else {
      const rate = i.price + addOns.reduce((s, a) => s + a.price, 0);
      lines.set(key, { name: i.name, addOns, qty: i.qty, rate });
    }
  }
  const items = [...lines.values()].map((l) => ({ ...l, amount: l.rate * l.qty }));
  if (items.reduce((s, l) => s + l.amount, 0) !== bill.subtotal)
    throw new Error(`Bill ${bill.billNumber}: items do not add up to the subtotal`);
  return items;
}

async function createInvoice(billId, body, user, session) {
  const opts = { session };
  // Replay check first: a retry after success must work even though the bill is now paid.
  const replay = await Invoice.findOne({ idempotencyKey: body.idempotencyKey }, null, opts);
  if (replay) return { invoice: replay, replayed: true };

  const bill = await RunningBill.findById(billId, null, opts);
  if (!bill) throw new HttpError(404, 'Bill not found');
  if (bill.invoiceId || bill.status === 'paid') throw alreadyInvoiced();
  if (bill.status === 'open') throw new HttpError(409, 'Proceed to checkout first');
  if (bill.status !== 'billing')
    throw new HttpError(409, `Bill ${bill.billNumber} is ${bill.status}`);

  const settings = await getSettings();
  // A zero discount is no discount (nothing to approve or audit).
  const discount = body.discount?.value ? body.discount : null;
  if (discount && user.role !== 'admin') {
    const limit = user.maxDiscountPercent ?? 0;
    const over =
      discount.type === 'percent'
        ? discount.value > limit
        : discount.value * 100 > bill.subtotal * limit;
    if (over) throw new HttpError(403, `Discount above your limit of ${limit}%`);
  }
  const calc = calculateBill({
    subtotal: bill.subtotal,
    discount,
    gstRate: settings.gstRate,
    pricesIncludeTax: settings.pricesIncludeTax,
  });

  const paid = body.payments.reduce((s, p) => s + p.amount, 0);
  if (paid !== calc.grandTotal)
    throw new HttpError(
      422,
      `Payments total ${rupees(paid)} but the bill is ${rupees(calc.grandTotal)}`,
    );
  const payments = body.payments.map((p) =>
    p.method === 'cash'
      ? {
          method: 'cash',
          amount: p.amount,
          tendered: p.tendered ?? p.amount,
          change: (p.tendered ?? p.amount) - p.amount,
        }
      : { method: p.method, amount: p.amount, reference: p.reference ?? '' },
  );
  const items = invoiceItems(bill);

  const invoiceNumber = await nextInvoiceNumber(settings.invoicePrefix, {
    session,
    startNumber: settings.invoiceStartNumber,
  });
  const [invoice] = await Invoice.create(
    [
      {
        invoiceNumber,
        billId: bill._id,
        billNumber: bill.billNumber,
        idempotencyKey: body.idempotencyKey,
        restaurant: {
          name: settings.name,
          address: settings.address,
          phone: settings.phone,
          gstin: settings.gstin,
          logoUrl: settings.logoUrl,
          footer: settings.invoiceFooter,
        },
        customer: {
          customerId: bill.customerId,
          name: bill.customerName,
          mobile: bill.customerMobile,
        },
        tableNumber: bill.tableNumber,
        items,
        ...calc,
        discount: calc.discount ? { ...calc.discount, approvedBy: user._id } : undefined,
        gstRate: settings.gstRate,
        payments,
        cashierId: user._id,
        cashierName: user.name,
      },
    ],
    opts,
  );

  const now = new Date();
  const b = await RunningBill.updateOne(
    { _id: bill._id, status: 'billing', invoiceId: null },
    { status: 'paid', closedAt: now, invoiceId: invoice._id },
    opts,
  );
  const t = await Table.updateOne(
    { _id: bill.tableId, status: 'billing', currentBillId: bill._id },
    { status: 'available', currentBillId: null },
    opts,
  );
  if (!b.modifiedCount || !t.modifiedCount)
    throw new HttpError(409, 'Bill or table changed meanwhile. Please refresh.');
  await Customer.updateOne(
    { _id: bill.customerId },
    { $inc: { totalVisits: 1, totalSpent: calc.grandTotal }, $set: { lastVisitAt: now } },
    opts,
  );

  await audit(
    user,
    'invoice.create',
    'invoice',
    invoice._id,
    { invoiceNumber, grandTotal: calc.grandTotal, discount: calc.discount },
    opts,
  );
  if (calc.discount)
    await audit(
      user,
      'bill.discount',
      'runningBill',
      bill._id,
      { invoiceNumber, ...calc.discount },
      opts,
    );
  return { invoice, replayed: false };
}

invoicingRouter.post(
  '/:id/invoice',
  auth,
  requireRole('admin', 'cashier'),
  validate(idParams, 'params'),
  validate(invoiceBody),
  async (req, res) => {
    let result;
    try {
      // connection.transaction retries transient write conflicts; the retry re-runs the replay check.
      await mongoose.connection.transaction(async (session) => {
        result = await createInvoice(req.params.id, req.body, req.user, session);
      });
    } catch (err) {
      if (err?.code !== 11000) throw err;
      // Unique indexes are the final guard against concurrent requests.
      if (err.keyPattern?.idempotencyKey) {
        const invoice = await Invoice.findOne({ idempotencyKey: req.body.idempotencyKey });
        if (invoice) result = { invoice, replayed: true };
      } else if (err.keyPattern?.billId) throw alreadyInvoiced();
      if (!result) throw err;
    }
    const { invoice, replayed } = result;
    ok(res, invoice, `Invoice ${invoice.invoiceNumber} generated`, replayed ? 200 : 201);
  },
);

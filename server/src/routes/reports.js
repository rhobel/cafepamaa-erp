import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Invoice } from '../models/Invoice.js';
import { RunningBill } from '../models/RunningBill.js';
import { auth, requireRole } from '../middleware/auth.js';
import { validate, idParams } from '../middleware/validate.js';
import { HttpError, ok } from '../utils/http.js';

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const TZ = 'Asia/Kolkata';
const istDay = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TZ } };

export const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
export const todayIST = () => new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);

function istDayStart(day) {
  const d = new Date(`${day}T00:00:00+05:30`);
  // Round-trip rejects impossible dates like 2026-02-31 (JS would roll them into March).
  if (
    Number.isNaN(d.getTime()) ||
    new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10) !== day
  )
    throw new HttpError(422, `Invalid date ${day}`);
  return d;
}

/** Inclusive IST calendar days → UTC range [from 00:00 IST, to+1 00:00 IST). */
export function istRange(from, to) {
  const start = istDayStart(from);
  const end = new Date(istDayStart(to).getTime() + DAY_MS);
  if (start >= end) throw new HttpError(422, '`from` must be on or before `to`');
  return { start, end };
}

/** Shared invoice $match for reports and the dashboard. */
export function invoiceMatch({ start, end, cashier, method }) {
  return {
    createdAt: { $gte: start, $lt: end },
    ...(cashier && { cashierId: new mongoose.Types.ObjectId(String(cashier)) }),
    ...(method && { 'payments.method': method }),
  };
}

const sum = (field) => ({ $sum: field });
const byDay = (fields) => [
  { $group: { _id: istDay, ...fields } },
  { $sort: { _id: 1 } },
  { $set: { date: '$_id' } },
  { $unset: '_id' },
];

// Each takes the invoice $match (+ filters) and returns rows. Money in paise.
export const REPORTS = {
  sales: (match) =>
    Invoice.aggregate([
      { $match: match },
      ...byDay({
        bills: sum(1),
        subtotal: sum('$subtotal'),
        discount: sum({ $ifNull: ['$discount.amount', 0] }),
        taxable: sum('$taxableAmount'),
        cgst: sum('$cgst'),
        sgst: sum('$sgst'),
        roundOff: sum('$roundOff'),
        grandTotal: sum('$grandTotal'),
      }),
    ]),

  // ₹0 invoices have payments: [] — $unwind drops them, so they add nothing here.
  payments: (match, { method } = {}) =>
    Invoice.aggregate([
      { $match: match },
      { $unwind: '$payments' },
      ...(method ? [{ $match: { 'payments.method': method } }] : []),
      { $group: { _id: '$payments.method', count: sum(1), amount: sum('$payments.amount') } },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, method: '$_id', count: 1, amount: 1 } },
    ]),

  items: (match) =>
    Invoice.aggregate([
      { $match: match },
      { $unwind: '$items' },
      { $group: { _id: '$items.name', qty: sum('$items.qty'), amount: sum('$items.amount') } },
      { $sort: { amount: -1, _id: 1 } },
      { $project: { _id: 0, name: '$_id', qty: 1, amount: 1 } },
    ]),

  // Invoice items carry no category: walk back to the bills' non-voided round items → menu item → category.
  // Bill ids first, then one indexed $in match — ~5x faster than a per-invoice $lookup on 50k invoices.
  // ponytail: the $in list grows with the range (~1 MB BSON per 50k invoices, cap 16 MB); snapshot categoryId
  // onto invoice items if a year ever exceeds ~500k invoices.
  categories: async (match, { category } = {}) => {
    const bills = await Invoice.find(match, { _id: 0, billId: 1 }).lean();
    return RunningBill.aggregate([
      { $match: { _id: { $in: bills.map((b) => b.billId) } } },
      { $project: { _id: 0, items: '$rounds.items' } },
      { $unwind: '$items' },
      { $unwind: '$items' },
      { $replaceWith: '$items' },
      { $match: { isVoided: { $ne: true } } },
      // Collapse to one row per menu item first, so the lookups below run ~menu-size times, not per line.
      { $group: { _id: '$menuItemId', qty: sum('$qty'), lineTotal: sum('$lineTotal') } },
      { $lookup: { from: 'menuitems', localField: '_id', foreignField: '_id', as: 'mi' } },
      {
        $lookup: {
          from: 'categories',
          localField: 'mi.categoryId',
          foreignField: '_id',
          as: 'cat',
        },
      },
      ...(category
        ? [{ $match: { 'cat._id': new mongoose.Types.ObjectId(String(category)) } }]
        : []),
      {
        $group: {
          _id: { $ifNull: [{ $first: '$cat.name' }, 'Uncategorised'] },
          qty: sum('$qty'),
          amount: sum('$lineTotal'),
        },
      },
      { $sort: { amount: -1, _id: 1 } },
      { $project: { _id: 0, category: '$_id', qty: 1, amount: 1 } },
    ]);
  },

  discounts: (match) =>
    Invoice.aggregate([
      { $match: { ...match, 'discount.amount': { $gt: 0 } } },
      { $sort: { createdAt: 1 } },
      {
        $project: {
          _id: 0,
          invoiceId: '$_id',
          invoiceNumber: 1,
          date: istDay,
          cashierName: 1,
          type: '$discount.type',
          value: '$discount.value',
          amount: '$discount.amount',
        },
      },
    ]),

  gst: (match) =>
    Invoice.aggregate([
      { $match: match },
      ...byDay({ taxable: sum('$taxableAmount'), cgst: sum('$cgst'), sgst: sum('$sgst') }),
      { $set: { tax: { $add: ['$cgst', '$sgst'] } } },
    ]),
};

const TOTAL_FIELDS = {
  sales: ['bills', 'subtotal', 'discount', 'taxable', 'cgst', 'sgst', 'roundOff', 'grandTotal'],
  payments: ['count', 'amount'],
  items: ['qty', 'amount'],
  categories: ['qty', 'amount'],
  discounts: ['amount'],
  gst: ['taxable', 'cgst', 'sgst', 'tax'],
};

/** Totals are summed from the (already aggregated, small) rows. */
export function totalsOf(type, rows) {
  const totals = Object.fromEntries(
    TOTAL_FIELDS[type].map((f) => [f, rows.reduce((s, r) => s + (r[f] ?? 0), 0)]),
  );
  if (type === 'discounts') totals.count = rows.length;
  return totals;
}

export const reportsRouter = Router();
reportsRouter.use(auth, requireRole('admin', 'cashier'));

const reportParams = z.object({ type: z.enum(Object.keys(REPORTS)) });
const reportQuery = z.object({
  from: ymd.optional(),
  to: ymd.optional(),
  cashier: idParams.shape.id.optional(),
  method: z.enum(['cash', 'upi', 'card']).optional(),
  category: idParams.shape.id.optional(),
});

reportsRouter.get(
  '/:type',
  validate(reportParams, 'params'),
  validate(reportQuery, 'query'),
  async (req, res) => {
    const { type } = req.params;
    let { from, to, cashier, method, category } = req.validQuery;
    if (req.user.role === 'cashier') {
      // Own shift only: today's invoices billed by this cashier, whatever was asked for.
      from = to = todayIST();
      cashier = req.user._id;
    } else {
      to ??= from ?? todayIST();
      from ??= to;
    }
    const range = istRange(from, to);
    if (range.end - range.start > 366 * DAY_MS)
      throw new HttpError(422, 'Date range cannot exceed 366 days');

    const rows = await REPORTS[type](invoiceMatch({ ...range, cashier, method }), {
      method,
      category,
    });
    ok(res, { type, from, to, rows, totals: totalsOf(type, rows) });
  },
);

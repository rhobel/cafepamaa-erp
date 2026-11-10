import { Router } from 'express';
import { z } from 'zod';
import { Invoice } from '../models/Invoice.js';
import { auth, requireRole } from '../middleware/auth.js';
import { validate, idParams } from '../middleware/validate.js';
import { audit } from '../services/audit.js';
import { HttpError, ok } from '../utils/http.js';
import { istRange, ymd } from './reports.js';

// Invoices are immutable: read, list and reprint only — no PATCH/DELETE.
export const invoicesRouter = Router();
invoicesRouter.use(auth, requireRole('admin', 'cashier'));

export const INVOICE_SUMMARY =
  'invoiceNumber createdAt billNumber tableNumber customer grandTotal payments.method payments.amount cashierName';

const listQuery = z.object({
  from: ymd.optional(),
  to: ymd.optional(),
  q: z.string().trim().max(50).optional(),
  table: z.string().trim().toUpperCase().max(20).optional(),
  method: z.enum(['cash', 'upi', 'card']).optional(),
  cashier: idParams.shape.id.optional(),
  customer: idParams.shape.id.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// Plain array (customer profile depends on it); the client detects more pages via length === limit.
invoicesRouter.get('/', validate(listQuery, 'query'), async (req, res) => {
  const { from, to, q, table, method, cashier, customer, page, limit } = req.validQuery;
  const filter = {
    ...(customer && { 'customer.customerId': customer }),
    ...(table && { tableNumber: table }),
    ...(method && { 'payments.method': method }),
    ...(cashier && { cashierId: cashier }),
  };
  if (from || to) {
    const { start, end } = istRange(from ?? '2000-01-01', to ?? '2999-12-31');
    filter.createdAt = { $gte: start, $lt: end };
  }
  if (q) {
    const byNumber = {
      invoiceNumber: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' },
    };
    filter.$or = /^\d{10}$/.test(q) ? [byNumber, { 'customer.mobile': q }] : [byNumber];
  }
  ok(
    res,
    await Invoice.find(filter, INVOICE_SUMMARY)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  );
});

invoicesRouter.get('/:id', validate(idParams, 'params'), async (req, res) => {
  const invoice = await Invoice.findById(req.params.id).lean();
  if (!invoice) throw new HttpError(404, 'Invoice not found');
  ok(res, invoice);
});

invoicesRouter.post('/:id/reprint', validate(idParams, 'params'), async (req, res) => {
  const invoice = await Invoice.findByIdAndUpdate(
    req.params.id,
    { $inc: { printCount: 1 } },
    { returnDocument: 'after' },
  ).lean();
  if (!invoice) throw new HttpError(404, 'Invoice not found');
  await audit(req.user, 'invoice.reprint', 'invoice', invoice._id, {
    invoiceNumber: invoice.invoiceNumber,
    printCount: invoice.printCount,
  });
  ok(res, invoice, 'Duplicate copy ready');
});

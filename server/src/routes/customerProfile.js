import { Router } from 'express';
import { z } from 'zod';
import { Customer } from '../models/Customer.js';
import { Invoice } from '../models/Invoice.js';
import { RunningBill, ACTIVE_BILL } from '../models/RunningBill.js';
import { auth } from '../middleware/auth.js';
import { validate, idParams } from '../middleware/validate.js';
import { HttpError, ok } from '../utils/http.js';
import { INVOICE_SUMMARY } from './invoices.js';

// Mounted after customersRouter (which owns GET / and POST /). All roles may search customers.
export const customerProfileRouter = Router();
customerProfileRouter.use(auth);

const FIELDS = 'mobile name totalVisits totalSpent lastVisitAt';
const searchQuery = z.object({ q: z.string().trim().max(80).default('') });
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

customerProfileRouter.get('/search', validate(searchQuery, 'query'), async (req, res) => {
  const { q } = req.validQuery;
  const filter = !q
    ? {}
    : /^\d+$/.test(q)
      ? { mobile: { $regex: q } }
      : { name: { $regex: escapeRegex(q), $options: 'i' } };
  // ponytail: unindexed regex scan, fine for a single cafe's customer list; add a text index if it grows large.
  // Descending sort puts null lastVisitAt last.
  const customers = await Customer.find(filter, FIELDS)
    .sort({ lastVisitAt: -1, createdAt: -1 })
    .limit(50)
    .lean();
  ok(res, customers);
});

const findCustomer = async (id) => {
  const customer = await Customer.findById(id).lean();
  if (!customer) throw new HttpError(404, 'Customer not found');
  return customer;
};

customerProfileRouter.get('/:id', validate(idParams, 'params'), async (req, res) => {
  ok(res, await findCustomer(req.params.id));
});

customerProfileRouter.get('/:id/history', validate(idParams, 'params'), async (req, res) => {
  const customer = await findCustomer(req.params.id);
  const [activeBill, invoices] = await Promise.all([
    RunningBill.findOne(
      { customerId: customer._id, status: { $in: ACTIVE_BILL } },
      'billNumber tableNumber status subtotal',
    ).lean(),
    Invoice.find({ 'customer.customerId': customer._id }, INVOICE_SUMMARY)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),
  ]);
  ok(res, { customer, activeBill, invoices });
});

import { Router } from 'express';
import { z } from 'zod';
import { Customer } from '../models/Customer.js';
import { RunningBill, ACTIVE_BILL } from '../models/RunningBill.js';
import { auth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { HttpError, ok } from '../utils/http.js';

export const customersRouter = Router();
customersRouter.use(auth);

const mobile = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number');
const createSchema = z.object({ mobile, name: z.string().trim().max(80).optional() });

customersRouter.get('/', validate(z.object({ mobile }), 'query'), async (req, res) => {
  const customer = await Customer.findOne({ mobile: req.validQuery.mobile }).lean();
  const activeBill = customer
    ? await RunningBill.findOne(
        { customerId: customer._id, status: { $in: ACTIVE_BILL } },
        'billNumber tableId tableNumber status subtotal',
      ).lean()
    : null;
  ok(res, { customer, activeBill });
});

customersRouter.post('/', validate(createSchema), async (req, res) => {
  if (await Customer.exists({ mobile: req.body.mobile }))
    throw new HttpError(409, 'Customer already exists');
  ok(res, await Customer.create(req.body), 'Customer added', 201);
});

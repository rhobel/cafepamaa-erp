import { Router } from 'express';
import { Invoice } from '../models/Invoice.js';
import { RunningBill, ACTIVE_BILL } from '../models/RunningBill.js';
import { Table } from '../models/Table.js';
import { auth, requireRole } from '../middleware/auth.js';
import { ok } from '../utils/http.js';
import { INVOICE_SUMMARY } from './invoices.js';
import { REPORTS, invoiceMatch, istRange, todayIST } from './reports.js';

export const dashboardRouter = Router();
dashboardRouter.use(auth, requireRole('admin', 'cashier'));

dashboardRouter.get('/summary', async (req, res) => {
  const date = todayIST();
  // Cashier sees only their own invoices today; open bills and tables are shared floor state.
  const match = invoiceMatch({
    ...istRange(date, date),
    cashier: req.user.role === 'cashier' ? req.user._id : undefined,
  });

  const [[totals], split, recentInvoices, [open], tableCounts] = await Promise.all([
    Invoice.aggregate([
      { $match: match },
      { $group: { _id: null, sales: { $sum: '$grandTotal' }, billCount: { $sum: 1 } } },
    ]),
    REPORTS.payments(match),
    Invoice.find(match, INVOICE_SUMMARY).sort({ createdAt: -1 }).limit(10).lean(),
    RunningBill.aggregate([
      { $match: { status: { $in: ACTIVE_BILL } } },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$subtotal' } } },
    ]),
    Table.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]),
  ]);

  const tables = { available: 0, occupied: 0, billing: 0, total: 0 };
  for (const t of tableCounts) {
    tables[t._id] = t.n;
    tables.total += t.n;
  }
  const paymentSplit = { cash: 0, upi: 0, card: 0 };
  for (const p of split) paymentSplit[p.method] = p.amount;

  ok(res, {
    date,
    sales: totals?.sales ?? 0,
    billCount: totals?.billCount ?? 0,
    openBills: { count: open?.count ?? 0, value: open?.value ?? 0 },
    tables,
    paymentSplit,
    recentInvoices,
  });
});

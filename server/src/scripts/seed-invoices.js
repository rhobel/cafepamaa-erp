// Perf check (S5-6): inserts N synthetic invoices over the last 90 days, then times every report pipeline.
// Usage (scratch DB only!): MONGODB_URI=mongodb://127.0.0.1:27017/pamaa_perf node src/scripts/seed-invoices.js 50000
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { Invoice } from '../models/Invoice.js';
import { REPORTS, invoiceMatch, istRange, todayIST } from '../routes/reports.js';

if (config.isProd) {
  console.error('Refusing to seed synthetic invoices in production.');
  process.exit(1);
}

const N = Number(process.argv[2] ?? 50000);
const BATCH = 2000;
const DAY_MS = 86400000;
const ITEMS = ['Masala Dosa', 'Idli', 'Coffee', 'Tea', 'Paneer Dosa', 'Vada', 'Upma', 'Juice'];
const METHODS = ['cash', 'upi', 'card'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const cashiers = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];

function fakeInvoice(i) {
  const items = Array.from({ length: 1 + (i % 4) }, () => {
    const qty = 1 + Math.floor(Math.random() * 3);
    const rate = 2000 + Math.floor(Math.random() * 20) * 500;
    return { name: pick(ITEMS), qty, rate, amount: qty * rate };
  });
  const subtotal = items.reduce((s, it) => s + it.amount, 0);
  const discount = i % 10 === 0 ? Math.round(subtotal / 10) : 0;
  const taxable = subtotal - discount;
  const half = Math.round(taxable * 0.025);
  const grandTotal = taxable + 2 * half;
  return {
    invoiceNumber: `PERF/${randomUUID()}`,
    billId: new mongoose.Types.ObjectId(),
    billNumber: `RB-P${i}`,
    idempotencyKey: randomUUID(),
    customer: { name: 'Perf', mobile: `9${String(i).padStart(9, '0')}` },
    tableNumber: `T${1 + (i % 20)}`,
    items,
    subtotal,
    ...(discount && { discount: { type: 'percent', value: 10, amount: discount } }),
    taxableAmount: taxable,
    gstRate: 5,
    cgst: half,
    sgst: half,
    roundOff: 0,
    grandTotal,
    payments: [{ method: pick(METHODS), amount: grandTotal }],
    cashierId: pick(cashiers),
    cashierName: 'perf',
    createdAt: new Date(Date.now() - Math.random() * 90 * DAY_MS),
  };
}

await mongoose.connect(config.MONGODB_URI);
try {
  await Invoice.syncIndexes();
  let t = performance.now();
  for (let i = 0; i < N; i += BATCH) {
    const docs = Array.from({ length: Math.min(BATCH, N - i) }, (_, k) => fakeInvoice(i + k));
    await Invoice.insertMany(docs, { lean: true });
  }
  console.log(`Inserted ${N} invoices in ${Math.round(performance.now() - t)} ms`);

  const today = todayIST();
  const from90 = new Date(Date.now() + 330 * 60000 - 89 * DAY_MS).toISOString().slice(0, 10);
  const ranges = { today: istRange(today, today), '90 days': istRange(from90, today) };
  for (const [label, range] of Object.entries(ranges)) {
    for (const [type, run] of Object.entries(REPORTS)) {
      t = performance.now();
      const rows = await run(invoiceMatch(range));
      console.log(
        `${label.padEnd(8)} ${type.padEnd(11)} ${String(Math.round(performance.now() - t)).padStart(5)} ms  (${rows.length} rows)`,
      );
    }
    t = performance.now();
    await REPORTS.sales(invoiceMatch({ ...range, method: 'cash', cashier: cashiers[0] }));
    console.log(
      `${label.padEnd(8)} sales+cash  ${String(Math.round(performance.now() - t)).padStart(5)} ms`,
    );
  }
} finally {
  await mongoose.disconnect();
}

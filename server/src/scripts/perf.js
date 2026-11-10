// Perf check (S6-3): seeds a big restaurant into its OWN scratch DB, runs the app in-process and times the
// hot endpoints (p50/p95). Drops the DB at the end.
// Usage (from server/): node --env-file-if-exists=.env src/scripts/perf.js   [PERF_RUNS=30]
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/pamaa_perf'; // never the dev DB
process.env.NODE_ENV = 'test'; // no request logging
process.env.JWT_SECRET ??= 'perf-access-secret-perf-access-secret-00000';
process.env.JWT_REFRESH_SECRET ??= 'perf-refresh-secret-perf-refresh-secret-000';
process.env.CLIENT_URL ??= 'http://localhost:5173';

const { default: mongoose } = await import('mongoose');
const { randomUUID } = await import('node:crypto');
const { createApp } = await import('../app.js');
const { User } = await import('../models/User.js');
const { Category } = await import('../models/Category.js');
const { MenuItem } = await import('../models/MenuItem.js');
const { Table } = await import('../models/Table.js');
const { Customer } = await import('../models/Customer.js');
const { RunningBill } = await import('../models/RunningBill.js');
const { Invoice } = await import('../models/Invoice.js');
const { todayIST } = await import('../routes/reports.js');

const RUNS = Number(process.env.PERF_RUNS ?? 30);
const DAY_MS = 86400000;
const N_INVOICES = 50000;
const N_CUSTOMERS = 5000;
const oid = () => new mongoose.Types.ObjectId();
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const ymdDaysAgo = (n) =>
  new Date(Date.now() + 330 * 60000 - n * DAY_MS).toISOString().slice(0, 10);

async function seed() {
  const users = {};
  for (const [username, role] of [
    ['admin', 'admin'],
    ['waiter', 'waiter'],
    ['cashier', 'cashier'],
  ]) {
    const u = new User({ name: username, username, role, maxDiscountPercent: 10 });
    await u.setPassword('secret123');
    users[role] = await u.save();
  }

  const cats = await Category.insertMany(
    Array.from({ length: 10 }, (_, i) => ({ name: `Category ${i}`, sortOrder: i })),
  );
  const menu = await MenuItem.insertMany(
    Array.from({ length: 200 }, (_, i) => ({
      name: `Dish ${i}`,
      description: 'A tasty dish with a medium-length description for realism.',
      categoryId: cats[i % 10]._id,
      price: 5000 + (i % 30) * 1000,
      imageUrl: `https://res.cloudinary.com/demo/image/upload/dish-${i}.jpg`,
      addOns: [
        { name: 'Extra cheese', price: 2000 },
        { name: 'Extra spicy', price: 0 },
      ],
    })),
  );
  const tables = await Table.insertMany(
    Array.from({ length: 40 }, (_, i) => ({
      tableNumber: `T${i + 1}`,
      capacity: 4,
      section: i < 20 ? 'Indoor' : 'Outdoor',
    })),
  );

  const customers = Array.from({ length: N_CUSTOMERS }, (_, i) => ({
    _id: oid(),
    mobile: `9${String(i).padStart(9, '0')}`,
    name: `Customer ${i}`,
    totalVisits: 10,
    totalSpent: 100000,
    lastVisitAt: new Date(Date.now() - Math.random() * 365 * DAY_MS),
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  await Customer.collection.insertMany(customers);

  const line = (m, qty) => ({
    _id: oid(),
    menuItemId: m._id,
    name: m.name,
    price: m.price,
    qty,
    addOns: [],
    instructions: '',
    lineTotal: m.price * qty,
    isVoided: false,
    voidReason: '',
  });
  const round = (waiter, items, createdAt) => ({
    _id: oid(),
    orderNumber: `ORD-${randomUUID().slice(0, 8)}`,
    waiterId: waiter._id,
    waiterName: waiter.name,
    idempotencyKey: randomUUID(),
    createdAt,
    items,
  });

  // History: 50k paid bills + their invoices over the last 12 months.
  const cashiers = [users.cashier, users.admin];
  for (let i = 0; i < N_INVOICES; i += 2000) {
    const bills = [];
    const invoices = [];
    for (let k = i; k < Math.min(i + 2000, N_INVOICES); k++) {
      const createdAt = new Date(Date.now() - Math.random() * 365 * DAY_MS);
      const c = customers[k % N_CUSTOMERS];
      const t = tables[k % 40];
      const items = Array.from({ length: 1 + (k % 5) }, () => line(pick(menu), 1 + (k % 3)));
      const subtotal = items.reduce((s, x) => s + x.lineTotal, 0);
      const discount = k % 10 === 0 ? Math.round(subtotal / 10) : 0;
      const taxable = subtotal - discount;
      const half = Math.round(taxable * 0.025);
      const grandTotal = taxable + 2 * half;
      const cashier = pick(cashiers);
      const billId = oid();
      const invoiceId = oid();
      bills.push({
        _id: billId,
        billNumber: `RB-H${k}`,
        customerId: c._id,
        customerMobile: c.mobile,
        customerName: c.name,
        tableId: t._id,
        tableNumber: t.tableNumber,
        status: 'paid',
        rounds: [round(users.waiter, items, createdAt)],
        subtotal,
        openedAt: createdAt,
        closedAt: createdAt,
        invoiceId,
        createdAt,
        updatedAt: createdAt,
      });
      invoices.push({
        _id: invoiceId,
        invoiceNumber: `INV/PERF/${String(k).padStart(6, '0')}`,
        billId,
        billNumber: `RB-H${k}`,
        idempotencyKey: randomUUID(),
        restaurant: { name: 'PAMAA', address: '1 Main Road', phone: '9999999999' },
        customer: { customerId: c._id, name: c.name, mobile: c.mobile },
        tableNumber: t.tableNumber,
        items: items.map((x) => ({
          name: x.name,
          addOns: [],
          qty: x.qty,
          rate: x.price,
          amount: x.lineTotal,
        })),
        subtotal,
        ...(discount && { discount: { type: 'percent', value: 10, amount: discount } }),
        taxableAmount: taxable,
        gstRate: 5,
        cgstRate: 2.5,
        sgstRate: 2.5,
        cgst: half,
        sgst: half,
        roundOff: 0,
        grandTotal,
        pricesIncludeTax: false,
        payments: [
          { method: pick(['cash', 'upi', 'card']), amount: grandTotal, paidAt: createdAt },
        ],
        paymentStatus: 'paid',
        cashierId: cashier._id,
        cashierName: cashier.name,
        printCount: 0,
        createdAt,
        updatedAt: createdAt,
      });
    }
    await RunningBill.collection.insertMany(bills);
    await Invoice.collection.insertMany(invoices);
  }

  // Floor: 20 open bills on T1–T20, 4 rounds each.
  const open = [];
  for (let j = 0; j < 20; j++) {
    const c = customers[N_CUSTOMERS - 1 - j];
    const rounds = Array.from({ length: 4 }, () =>
      round(
        users.waiter,
        Array.from({ length: 3 }, () => line(pick(menu), 2)),
        new Date(),
      ),
    );
    open.push({
      _id: oid(),
      billNumber: `RB-O${j}`,
      customerId: c._id,
      customerMobile: c.mobile,
      customerName: c.name,
      tableId: tables[j]._id,
      tableNumber: tables[j].tableNumber,
      status: 'open',
      rounds,
      subtotal: rounds.flatMap((r) => r.items).reduce((s, x) => s + x.lineTotal, 0),
      openedAt: new Date(),
      closedAt: null,
      invoiceId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  await RunningBill.collection.insertMany(open);
  for (const b of open)
    await Table.updateOne({ _id: b.tableId }, { status: 'occupied', currentBillId: b._id });

  return { menu, tables, customers, open, users };
}

async function login(base, username) {
  const r = await fetch(base + '/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'secret123' }),
  });
  const { data } = await r.json();
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        authorization: `Bearer ${data.accessToken}`,
        ...(body !== undefined && { 'content-type': 'application/json' }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status} ${json.message}`);
    return json.data;
  };
}

const results = [];
const pct = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
function record(label, ms) {
  ms.sort((a, b) => a - b);
  results.push({ label, p50: pct(ms, 50), p95: pct(ms, 95) });
}
/** Times `fn(i)` RUNS times after one warm-up call. */
async function bench(label, fn) {
  await fn(0);
  const ms = [];
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    await fn(i);
    ms.push(performance.now() - t);
  }
  record(label, ms);
}

await mongoose.connect(process.env.MONGODB_URI);
await mongoose.connection.dropDatabase();
let server;
try {
  await mongoose.connection.syncIndexes();
  let t = performance.now();
  const { menu, tables, customers, open } = await seed();
  console.log(`Seeded in ${Math.round(performance.now() - t)} ms`);

  server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const admin = await login(base, 'admin');
  const waiter = await login(base, 'waiter');
  const cashier = await login(base, 'cashier');

  await bench('GET /menu-items', () => waiter('GET', '/menu-items'));
  await bench('GET /categories', () => waiter('GET', '/categories'));
  await bench('GET /tables', () => waiter('GET', '/tables'));
  await bench('GET /bills (active)', () => cashier('GET', '/bills'));
  await bench('GET /bills?mine (waiter)', () => waiter('GET', '/bills?mine=true'));
  await bench('GET /bills/:id', (i) => cashier('GET', `/bills/${open[i % 20]._id}`));
  await bench('GET /customers?mobile=', (i) =>
    waiter('GET', `/customers?mobile=${customers[i * 7].mobile}`),
  );
  await bench('POST /bills/orders (round)', (i) =>
    waiter('POST', '/bills/orders', {
      customerId: String(open[i % 20].customerId),
      billId: String(open[i % 20]._id),
      items: [
        { menuItemId: String(menu[i].id), qty: 2, addOnIds: [String(menu[i].addOns[0]._id)] },
        { menuItemId: String(menu[i + 50].id), qty: 1 },
      ],
      idempotencyKey: randomUUID(),
    }),
  );

  // Checkout → calculate → invoice, each on a fresh bill opened (untimed) on a free table T21–T40.
  const flow = { checkout: [], calculate: [], invoice: [] };
  const timed = async (key, fn) => {
    const t = performance.now();
    const out = await fn();
    flow[key].push(performance.now() - t);
    return out;
  };
  for (let i = 0; i < RUNS; i++) {
    const { bill } = await waiter('POST', '/bills/orders', {
      customerId: String(customers[100 + i]._id),
      tableId: String(tables[20 + (i % 20)]._id),
      billId: null,
      items: [{ menuItemId: String(menu[i].id), qty: 3 }],
      idempotencyKey: randomUUID(),
    });
    const { calc } = await timed('checkout', () => cashier('POST', `/bills/${bill._id}/checkout`));
    await timed('calculate', () =>
      cashier('POST', `/bills/${bill._id}/calculate`, { discount: { type: 'percent', value: 5 } }),
    );
    await timed('invoice', () =>
      cashier('POST', `/bills/${bill._id}/invoice`, {
        discount: null,
        payments: [{ method: 'upi', amount: calc.grandTotal }],
        idempotencyKey: randomUUID(),
      }),
    );
  }
  for (const [key, ms] of Object.entries(flow)) record(`POST /bills/:id/${key}`, ms);
  const today = todayIST();
  const m1 = ymdDaysAgo(29);
  const m12 = ymdDaysAgo(364);
  const cust = customers[42]._id;
  await bench('GET /invoices (page 1)', () => cashier('GET', '/invoices'));
  await bench('GET /invoices (12mo, upi, page 5)', () =>
    admin('GET', `/invoices?from=${m12}&to=${today}&method=upi&page=5`),
  );
  await bench('GET /invoices?table=T7 (page 3)', () => admin('GET', '/invoices?table=T7&page=3'));
  await bench('GET /invoices?q=<mobile>', () =>
    admin('GET', `/invoices?q=${customers[42].mobile}`),
  );
  await bench('GET /invoices?q=<number part>', () => admin('GET', '/invoices?q=PERF/0123'));
  await bench('GET /invoices?customer=', () => admin('GET', `/invoices?customer=${cust}`));
  await bench('GET /customers/:id/history', () => admin('GET', `/customers/${cust}/history`));
  await bench('GET /dashboard/summary (admin)', () => admin('GET', '/dashboard/summary'));
  await bench('GET /dashboard/summary (cashier)', () => cashier('GET', '/dashboard/summary'));
  for (const type of ['sales', 'payments', 'items', 'categories', 'discounts', 'gst']) {
    for (const [label, from] of [
      ['1mo', m1],
      ['12mo', m12],
    ]) {
      await bench(`GET /reports/${type} ${label}`, () =>
        admin('GET', `/reports/${type}?from=${from}&to=${today}`),
      );
    }
  }
  await bench('GET /customers/search (empty)', () => waiter('GET', '/customers/search'));
  await bench('GET /customers/search?q=98765', () => waiter('GET', '/customers/search?q=98765'));
  await bench('GET /customers/search?q=name', () =>
    waiter('GET', '/customers/search?q=customer 12'),
  );

  const f = (n) => n.toFixed(1).padStart(8);
  console.log(
    `\n${'endpoint'.padEnd(36)}${'p50 ms'.padStart(8)}${'p95 ms'.padStart(8)}  (runs=${RUNS})`,
  );
  for (const r of results)
    console.log(`${r.label.padEnd(36)}${f(r.p50)}${f(r.p95)}${r.p95 > 200 ? '  <-- slow' : ''}`);
} finally {
  server?.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

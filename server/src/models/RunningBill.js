import mongoose from 'mongoose';

export const BILL_STATUSES = ['open', 'billing', 'paid', 'cancelled'];
export const ACTIVE_BILL = ['open', 'billing'];

const { ObjectId } = mongoose.Schema.Types;
// Money is always integer paise. Name/price/add-ons are snapshots: later menu edits never change a saved round.
const paise = { type: Number, required: true, min: 0, validate: Number.isInteger };

const itemSchema = new mongoose.Schema({
  menuItemId: { type: ObjectId, ref: 'MenuItem', required: true },
  name: { type: String, required: true },
  price: paise,
  qty: { type: Number, required: true, min: 1, validate: Number.isInteger },
  addOns: [{ _id: false, name: String, price: paise }],
  instructions: { type: String, default: '' },
  lineTotal: paise,
  isVoided: { type: Boolean, default: false },
  voidReason: { type: String, default: '' },
});

const roundSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true },
  waiterId: { type: ObjectId, ref: 'User', required: true },
  waiterName: { type: String, required: true },
  idempotencyKey: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  items: [itemSchema],
});

const runningBillSchema = new mongoose.Schema(
  {
    billNumber: { type: String, required: true, unique: true },
    customerId: { type: ObjectId, ref: 'Customer', required: true },
    customerMobile: { type: String, required: true },
    customerName: { type: String, default: '' },
    tableId: { type: ObjectId, ref: 'Table', required: true },
    tableNumber: { type: String, required: true },
    status: { type: String, enum: BILL_STATUSES, default: 'open' },
    rounds: [roundSchema],
    subtotal: { type: Number, default: 0 }, // paise, sum of non-voided lineTotals
    openedAt: { type: Date, default: Date.now },
    closedAt: { type: Date, default: null },
    invoiceId: { type: ObjectId, ref: 'Invoice', default: null },
  },
  { timestamps: true, versionKey: false },
);
// One active session per table — the final guard against two waiters taking the same table.
runningBillSchema.index(
  { tableId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ACTIVE_BILL } } },
);
runningBillSchema.index({ status: 1, openedAt: -1 }); // running-bills list (polled) + dashboard
runningBillSchema.index({ customerId: 1, status: 1 }); // customer's active bill (lookup, new order)
// Unique across bills: a retried order can never be saved twice.
runningBillSchema.index(
  { 'rounds.idempotencyKey': 1 },
  { unique: true, partialFilterExpression: { 'rounds.idempotencyKey': { $exists: true } } }, // bills with no rounds don't collide on null
);

export const RunningBill = mongoose.model('RunningBill', runningBillSchema);

import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;
// Money is integer paise. An invoice is a frozen snapshot: items, totals AND restaurant details are copied in,
// so later menu/settings changes never alter a past invoice or its reprints.
const paise = { type: Number, required: true, validate: Number.isInteger };

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true }, // INV/2026-27/00001
    billId: { type: ObjectId, ref: 'RunningBill', required: true, unique: true }, // one invoice per bill
    billNumber: { type: String, required: true },
    idempotencyKey: { type: String, required: true, unique: true },
    restaurant: {
      name: String,
      address: String,
      phone: String,
      gstin: String,
      logoUrl: String,
      footer: String,
    },
    customer: { customerId: { type: ObjectId, ref: 'Customer' }, name: String, mobile: String },
    tableNumber: { type: String, required: true },
    items: [
      {
        _id: false,
        name: { type: String, required: true },
        addOns: [{ _id: false, name: String, price: paise }],
        qty: { type: Number, required: true },
        rate: paise, // unit price incl. add-ons
        amount: paise, // rate × qty
      },
    ],
    subtotal: paise,
    discount: {
      type: { type: String, enum: ['percent', 'flat'] },
      value: Number, // percent, or flat paise
      amount: Number, // paise
      approvedBy: { type: ObjectId, ref: 'User' },
    },
    taxableAmount: paise,
    gstRate: { type: Number, required: true },
    cgstRate: Number,
    sgstRate: Number,
    cgst: paise,
    sgst: paise,
    roundOff: paise, // may be negative
    grandTotal: paise,
    pricesIncludeTax: Boolean,
    payments: [
      {
        _id: false,
        method: { type: String, enum: ['cash', 'upi', 'card'], required: true },
        amount: { ...paise, min: 1 }, // applied to the bill
        tendered: { type: Number, default: null }, // cash only: handed over (≥ amount)
        change: { type: Number, default: 0 }, // cash only: tendered − amount
        reference: { type: String, default: '' }, // UPI / card txn ref
        paidAt: { type: Date, default: Date.now },
      },
    ],
    paymentStatus: { type: String, enum: ['paid'], default: 'paid' },
    cashierId: { type: ObjectId, ref: 'User', required: true },
    cashierName: String,
    printCount: { type: Number, default: 0 }, // reprints; > 0 prints "DUPLICATE COPY"
  },
  { timestamps: true, versionKey: false },
);
invoiceSchema.index({ createdAt: -1 });
invoiceSchema.index({ 'customer.mobile': 1, createdAt: -1 });
invoiceSchema.index({ cashierId: 1, createdAt: -1 });
invoiceSchema.index({ 'payments.method': 1, createdAt: -1 });
invoiceSchema.index({ tableNumber: 1, createdAt: -1 });
invoiceSchema.index({ 'customer.customerId': 1, createdAt: -1 }); // customer profile history

export const Invoice = mongoose.model('Invoice', invoiceSchema);

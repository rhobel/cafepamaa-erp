import mongoose from 'mongoose';

// Single document (_id: 'restaurant'). Read it with getSettings().
const settingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'restaurant' },
    name: { type: String, default: 'PAMAA', trim: true },
    address: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true },
    gstin: { type: String, default: '', trim: true, uppercase: true },
    logoUrl: { type: String, default: '' },
    gstRate: { type: Number, default: 5, min: 0, max: 28 }, // percent; split equally into CGST + SGST
    pricesIncludeTax: { type: Boolean, default: false },
    invoicePrefix: { type: String, default: 'INV', trim: true },
    invoiceStartNumber: { type: Number, default: 1, min: 1 }, // applied by invoice numbering (Sprint 4)
    invoiceFooter: { type: String, default: 'Thank you · Visit again', trim: true },
    printFormat: { type: String, enum: ['80mm', 'A4'], default: '80mm' },
  },
  { timestamps: true, versionKey: false },
);

export const Settings = mongoose.model('Settings', settingsSchema);

/** Returns the settings document, creating it with defaults on first use. */
export const getSettings = () =>
  Settings.findOneAndUpdate(
    { _id: 'restaurant' },
    { $setOnInsert: { _id: 'restaurant' } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );

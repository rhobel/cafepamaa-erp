import mongoose from 'mongoose';

// Money is always integer paise (₹80.00 → 8000). Never floats.
const paise = { type: Number, required: true, min: 0, validate: Number.isInteger };

const menuItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    price: paise,
    imageUrl: { type: String, default: '' },
    addOns: [{ name: { type: String, required: true, trim: true }, price: paise }],
    isAvailable: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false }, // soft delete: past orders reference items
  },
  { timestamps: true, versionKey: false },
);
menuItemSchema.index({ categoryId: 1, isDeleted: 1 });

export const MenuItem = mongoose.model('MenuItem', menuItemSchema);

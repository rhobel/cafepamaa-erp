import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false },
);
// Case-insensitive unique name: "Snacks" and "snacks" collide → 11000 → 409.
categorySchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

export const Category = mongoose.model('Category', categorySchema);

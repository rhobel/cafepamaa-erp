import mongoose from 'mongoose';

const customerSchema = new mongoose.Schema(
  {
    mobile: { type: String, required: true, unique: true, trim: true }, // 10 digits, validated at the route
    name: { type: String, default: '', trim: true },
    totalVisits: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 }, // paise
    lastVisitAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

export const Customer = mongoose.model('Customer', customerSchema);

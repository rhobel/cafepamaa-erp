import mongoose from 'mongoose';

export const TABLE_STATUSES = ['available', 'occupied', 'billing'];

const tableSchema = new mongoose.Schema(
  {
    tableNumber: { type: String, required: true, unique: true, trim: true, uppercase: true }, // "T5"
    capacity: { type: Number, required: true, min: 1, max: 50 },
    section: { type: String, default: '', trim: true },
    status: { type: String, enum: TABLE_STATUSES, default: 'available' }, // changed only by billing flows
    currentBillId: { type: mongoose.Schema.Types.ObjectId, ref: 'RunningBill', default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false },
);

export const Table = mongoose.model('Table', tableSchema);

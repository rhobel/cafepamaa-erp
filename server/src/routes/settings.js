import { Router } from 'express';
import { z } from 'zod';
import { auth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { getSettings } from '../models/Settings.js';
import { audit } from '../services/audit.js';
import { ok } from '../utils/http.js';

export const settingsRouter = Router();

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const upper = (s) => s.trim().toUpperCase();

const settingsBody = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  address: z.string().trim().max(300).default(''),
  phone: z
    .string()
    .trim()
    .regex(/^$|^[\d +]{10,15}$/, 'Phone must be 10–15 digits')
    .default(''),
  gstin: z
    .string()
    .transform(upper)
    .refine((s) => s === '' || GSTIN.test(s), 'Invalid GSTIN')
    .default(''),
  logoUrl: z
    .string()
    .trim()
    .refine((s) => s === '' || /^https:\/\/\S+$/.test(s), 'Logo must be an https URL')
    .default(''),
  gstRate: z
    .number()
    .min(0)
    .max(28)
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-9, 'At most 2 decimals'),
  pricesIncludeTax: z.boolean(),
  invoicePrefix: z
    .string()
    .transform(upper)
    .pipe(z.string().regex(/^[A-Z0-9-]{1,10}$/, 'Prefix: 1–10 letters, digits or -')),
  invoiceStartNumber: z.number().int().min(1),
  invoiceFooter: z.string().trim().max(200).default(''),
  printFormat: z.enum(['80mm', 'A4']),
});

settingsRouter.get('/', auth, async (req, res) => ok(res, await getSettings()));

settingsRouter.put('/', auth, requireRole('admin'), validate(settingsBody), async (req, res) => {
  const doc = await getSettings();
  const changes = {};
  for (const [k, v] of Object.entries(req.body)) {
    if (doc[k] !== v) changes[k] = { from: doc[k], to: v };
  }
  doc.set(req.body);
  await doc.save();
  if (Object.keys(changes).length) {
    // entityId omitted: AuditLog.entityId is an ObjectId and settings _id is 'restaurant'.
    await audit(req.user, 'settings.update', 'settings', undefined, changes);
  }
  ok(res, doc, 'Settings saved');
});

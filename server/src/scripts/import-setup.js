// Loads the owner's setup file (restaurant/GST settings, categories, menu, tables, staff) into the DB.
// Usage (from server/):
//   node --env-file-if-exists=.env src/scripts/import-setup.js path/to/setup.json [--dry-run] [--reset-passwords]
// Safe to re-run: matches existing rows and only creates/updates; never deletes. Field reference: docs/admin-handover.md.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Settings } from '../models/Settings.js';
import { Category } from '../models/Category.js';
import { MenuItem } from '../models/MenuItem.js';
import { Table } from '../models/Table.js';
import { User, ROLES } from '../models/User.js';

const MAX_PAISE = 10_000_000; // ₹1,00,000 — same cap as the menu API
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CI = { locale: 'en', strength: 2 }; // case-insensitive match, same collation as the category index

/** "80.5" | 80.5 → 8050 by string parsing (no float math). NaN if invalid or > 2 decimals. */
export function toPaise(rupees) {
  const s = String(rupees).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  const [r, p = ''] = s.split('.');
  return Number(r) * 100 + Number(p.padEnd(2, '0'));
}

const rupees = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const p = toPaise(v);
  if (Number.isNaN(p) || p > MAX_PAISE) {
    ctx.addIssue({
      code: 'custom',
      message: 'Price must be rupees with at most 2 decimals, e.g. 80 or "80.50" (max 100000)',
    });
    return z.NEVER;
  }
  return p;
});

const restaurantSchema = z.strictObject({
  name: z.string().trim().min(1, 'Name is required').max(80),
  address: z.string().trim().max(300).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^$|^[\d +]{10,15}$/, 'Phone must be 10–15 digits')
    .optional(),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .refine((s) => s === '' || GSTIN.test(s), 'Invalid GSTIN')
    .optional(),
  logoUrl: z
    .string()
    .trim()
    .refine((s) => s === '' || /^https:\/\/\S+$/.test(s), 'Logo must be an https URL')
    .optional(),
  gstRate: z
    .number()
    .min(0)
    .max(28)
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-9, 'At most 2 decimals')
    .optional(),
  pricesIncludeTax: z.boolean().optional(),
  invoicePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,10}$/, 'Prefix: 1–10 letters, digits or -')
    .optional(),
  invoiceStartNumber: z.number().int().min(1).optional(),
  invoiceFooter: z.string().trim().max(200).optional(),
  printFormat: z.enum(['80mm', 'A4']).optional(),
});

const itemSchema = z.strictObject({
  name: z.string().trim().min(1, 'Name is required').max(80),
  category: z.string().trim().min(1, 'Category is required'),
  price: rupees,
  description: z.string().trim().max(300).optional(),
  imageUrl: z
    .string()
    .trim()
    .refine((s) => s === '' || /^https:\/\/\S+$/.test(s), 'Image must be an https URL')
    .optional(),
  isAvailable: z.boolean().optional(),
  addOns: z
    .array(z.strictObject({ name: z.string().trim().min(1).max(40), price: rupees }))
    .max(20)
    .optional(),
});

const tableSchema = z.strictObject({
  tableNumber: z.string().trim().toUpperCase().min(1).max(10),
  capacity: z.number().int().min(1).max(50),
  section: z.string().trim().max(40).optional(),
  isActive: z.boolean().optional(),
});

const userSchema = z.strictObject({
  name: z.string().trim().min(1, 'Name is required').max(80),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'Username must be at least 3 characters')
    .max(40)
    .regex(/^[a-z0-9._-]+$/, 'Username may only contain letters, digits, . _ -'),
  role: z.enum(ROLES, 'Role must be admin, waiter or cashier'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128).optional(),
  maxDiscountPercent: z.number().min(0).max(100).optional(),
});

/** Adds an issue for every repeated key (case-insensitive) in a list. */
const noDupes = (ctx, list, path, keyOf, what) => {
  const seen = new Set();
  list.forEach((x, i) => {
    const k = keyOf(x).toLowerCase();
    if (seen.has(k))
      ctx.addIssue({ code: 'custom', path: [path, i], message: `Duplicate ${what}` });
    seen.add(k);
  });
};

const fileSchema = z
  .strictObject({
    restaurant: restaurantSchema.optional(),
    categories: z.array(z.string().trim().min(1).max(40)).default([]),
    menuItems: z.array(itemSchema).default([]),
    tables: z.array(tableSchema).default([]),
    users: z.array(userSchema).default([]),
  })
  .superRefine((d, ctx) => {
    noDupes(ctx, d.categories, 'categories', (c) => c, 'category name');
    noDupes(ctx, d.menuItems, 'menuItems', (m) => `${m.name}\0${m.category}`, 'item in category');
    noDupes(ctx, d.tables, 'tables', (t) => t.tableNumber, 'table number');
    noDupes(ctx, d.users, 'users', (u) => u.username, 'username');
  });

const pathOf = (path) =>
  path.reduce((s, p) => (typeof p === 'number' ? `${s}[${p}]` : s ? `${s}.${p}` : p), '') ||
  '(file)';

const norm = (key, v) =>
  JSON.stringify(key === 'addOns' ? (v ?? []).map((a) => ({ name: a.name, price: a.price })) : v);

/** Sets only the fields whose value differs; returns the changed keys. */
function applyChanges(doc, fields) {
  const changed = Object.keys(fields).filter(
    (k) => fields[k] !== undefined && norm(k, doc[k]) !== norm(k, fields[k]),
  );
  for (const k of changed) doc.set(k, fields[k]);
  return changed;
}

const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/**
 * Validates `input` and creates/updates rows. Requires an open mongoose connection.
 * Returns { errors: string[] } on any problem (nothing written), else { summary, lines }.
 */
export async function importSetup(input, { dryRun = false, resetPasswords = false } = {}) {
  const parsed = fileSchema.safeParse(input);
  if (!parsed.success) {
    return { errors: parsed.error.issues.map((i) => `${pathOf(i.path)}: ${i.message}`) };
  }
  const data = parsed.data;
  const errors = [];
  const steps = []; // { collection, label, action, changed, save }

  const plan = async (collection, label, doc, isNew, changed, extra) => {
    const action = isNew ? 'create' : changed.length ? 'update' : 'unchanged';
    if (action !== 'unchanged') {
      try {
        await doc.validate({
          pathsToSkip: isNew && collection === 'users' ? ['passwordHash'] : [],
        });
      } catch (e) {
        const msgs = e.errors ? Object.values(e.errors).map((x) => x.message) : [e.message];
        msgs.forEach((m) => errors.push(`${label}: ${m}`));
      }
    }
    steps.push({ collection, label, action, changed, save: extra ?? (() => doc.save()) });
  };

  // Settings (single document)
  if (data.restaurant) {
    const existing = await Settings.findById('restaurant');
    const doc = existing ?? new Settings({ _id: 'restaurant' });
    const changed = applyChanges(doc, data.restaurant);
    await plan('settings', 'restaurant', doc, !existing, changed);
  }

  // Categories, in file order → sortOrder
  const categoryId = new Map(); // lower-case name → _id (filled on save for new ones)
  for (const [i, name] of data.categories.entries()) {
    const existing = await Category.findOne({ name }).collation(CI);
    const doc = existing ?? new Category();
    const changed = applyChanges(doc, { name, sortOrder: i });
    if (existing) categoryId.set(name.toLowerCase(), doc._id);
    await plan('categories', `categories[${i}] "${name}"`, doc, !existing, changed, async () => {
      await doc.save();
      categoryId.set(name.toLowerCase(), doc._id);
    });
  }
  const inFile = new Set(data.categories.map((c) => c.toLowerCase()));

  // Menu items, matched by (name, category)
  for (const [i, m] of data.menuItems.entries()) {
    const label = `menuItems[${i}] "${m.name}"`;
    const key = m.category.toLowerCase();
    if (!categoryId.has(key) && !inFile.has(key)) {
      const cat = await Category.findOne({ name: m.category }).collation(CI);
      if (!cat) {
        errors.push(`${label}: category "${m.category}" is not in "categories" or the database`);
        continue;
      }
      categoryId.set(key, cat._id);
    }
    const catId = categoryId.get(key); // undefined → category is created in this run
    const existing =
      catId &&
      (await MenuItem.findOne({ name: m.name, categoryId: catId, isDeleted: false }).collation(CI));
    const fields = defined({
      name: m.name,
      price: m.price,
      description: m.description,
      imageUrl: m.imageUrl,
      isAvailable: m.isAvailable,
      addOns: m.addOns,
    });
    const doc = existing ?? new MenuItem({ categoryId: catId ?? new mongoose.Types.ObjectId() });
    const changed = applyChanges(doc, fields);
    await plan('menuItems', label, doc, !existing, changed, async () => {
      if (!existing) doc.categoryId = categoryId.get(key);
      await doc.save();
    });
  }

  // Tables, matched by tableNumber. status/currentBillId are never touched.
  for (const [i, t] of data.tables.entries()) {
    const existing = await Table.findOne({ tableNumber: t.tableNumber });
    const doc = existing ?? new Table();
    const changed = applyChanges(doc, defined(t));
    await plan('tables', `tables[${i}] ${t.tableNumber}`, doc, !existing, changed);
  }

  // Users, matched by username. Existing passwords are kept unless --reset-passwords.
  for (const [i, u] of data.users.entries()) {
    const label = `users[${i}] ${u.username}`;
    const existing = await User.findOne({ username: u.username }).select('+tokenVersion');
    if (!existing && !u.password) {
      errors.push(`${label}: password is required for a new user`);
      continue;
    }
    const { password, ...fields } = u;
    const doc = existing ?? new User();
    const changed = applyChanges(doc, defined(fields));
    const reset = existing && resetPasswords && password;
    if (reset) changed.push('password');
    await plan('users', label, doc, !existing, changed, async () => {
      if (!existing || reset) await doc.setPassword(password);
      if (reset) doc.tokenVersion += 1; // signs the user out everywhere, like an admin reset
      await doc.save();
    });
  }

  if (errors.length) return { errors };

  const summary = {};
  const lines = [];
  for (const s of steps) {
    summary[s.collection] ??= { created: 0, updated: 0, unchanged: 0 };
    summary[s.collection][
      { create: 'created', update: 'updated', unchanged: 'unchanged' }[s.action]
    ]++;
    if (s.action !== 'unchanged') {
      lines.push(
        `${s.action === 'create' ? '+ create' : '~ update'} ${s.label}${s.action === 'update' ? ` (${s.changed.join(', ')})` : ''}`,
      );
    }
    if (!dryRun && s.action !== 'unchanged') await s.save();
  }
  return { errors: [], summary, lines, dryRun };
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');
  const resetPasswords = args.includes('--reset-passwords');
  if (!file) {
    console.error('Usage: import-setup.js <setup.json> [--dry-run] [--reset-passwords]');
    process.exit(1);
  }
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set (put it in server/.env).');
    process.exit(1);
  }
  let input;
  try {
    input = JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    console.error(`Cannot read ${file}: ${e.message}`);
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const res = await importSetup(input, { dryRun, resetPasswords });
    if (res.errors.length) {
      console.error(`Found ${res.errors.length} problem(s); nothing was written:`);
      res.errors.forEach((e) => console.error(`  - ${e}`));
      process.exitCode = 1;
      return;
    }
    console.log(dryRun ? 'DRY RUN — nothing written. Plan:' : 'Done:');
    res.lines.forEach((l) => console.log(`  ${l}`));
    console.table(res.summary);
  } finally {
    await mongoose.disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();

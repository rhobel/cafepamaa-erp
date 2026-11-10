import { Router } from 'express';
import { z } from 'zod';
import { MenuItem } from '../models/MenuItem.js';
import { Category } from '../models/Category.js';
import { auth, requireRole } from '../middleware/auth.js';
import { validate, idParams } from '../middleware/validate.js';
import { audit } from '../services/audit.js';
import { HttpError, ok } from '../utils/http.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
// Integer paise only: 80.5 or "80" are rejected, never treated as rupees.
const paise = (max) =>
  z.number('Price must be a number').int('Price must be whole paise').min(0).max(max);

const itemSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  description: z.string().trim().max(300).optional(),
  categoryId: objectId,
  price: paise(10_000_000),
  imageUrl: z
    .union([z.literal(''), z.url({ protocol: /^https$/, error: 'Image must be an https URL' })])
    .optional(),
  addOns: z
    .array(
      z.object({
        name: z.string().trim().min(1, 'Add-on name is required').max(40),
        price: paise(10_000_000),
      }),
    )
    .max(20)
    .optional(),
  isAvailable: z.boolean().optional(),
});

const listQuery = z.object({
  category: objectId.optional(),
  search: z.string().trim().max(80).optional(),
  available: z.enum(['true', 'false']).optional(),
});

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function assertCategory(id) {
  if (!(await Category.exists({ _id: id }))) throw new HttpError(422, 'Category does not exist');
}

async function findLive(id) {
  const item = await MenuItem.findOne({ _id: id, isDeleted: false });
  if (!item) throw new HttpError(404, 'Menu item not found');
  return item;
}

const addOnsOf = (list = []) => list.map(({ name, price }) => ({ name, price }));

export const menuItemsRouter = Router();
menuItemsRouter.use(auth);
const admin = requireRole('admin');

menuItemsRouter.get('/', validate(listQuery, 'query'), async (req, res) => {
  const { category, search, available } = req.validQuery;
  const filter = { isDeleted: false };
  if (category) filter.categoryId = category;
  if (search) filter.name = { $regex: escapeRegex(search), $options: 'i' };
  if (available) filter.isAvailable = available === 'true';
  ok(res, await MenuItem.find(filter).sort({ name: 1 }).collation({ locale: 'en' }));
});

menuItemsRouter.get('/:id', validate(idParams, 'params'), async (req, res) => {
  ok(res, await findLive(req.params.id));
});

menuItemsRouter.post('/', admin, validate(itemSchema), async (req, res) => {
  await assertCategory(req.body.categoryId);
  const item = await MenuItem.create(req.body);
  await audit(req.user, 'menuItem.create', 'menuItem', item._id, { name: item.name });
  ok(res, item, 'Item added', 201);
});

menuItemsRouter.patch(
  '/:id',
  admin,
  validate(idParams, 'params'),
  validate(itemSchema.partial()),
  async (req, res) => {
    const item = await findLive(req.params.id);
    const body = req.body;
    if (body.categoryId) await assertCategory(body.categoryId);

    const before = { price: item.price, addOns: addOnsOf(item.addOns) };
    const changed = Object.keys(body).filter(
      (k) => JSON.stringify(body[k]) !== JSON.stringify(k === 'addOns' ? before.addOns : item[k]),
    );
    item.set(body);
    await item.save();

    // Bills snapshot name/price at order time (FR-O4); this trail explains later price differences.
    const id = item._id;
    if (changed.includes('price')) {
      await audit(req.user, 'menuItem.priceChange', 'menuItem', id, {
        from: before.price,
        to: item.price,
      });
    }
    if (changed.includes('addOns')) {
      await audit(req.user, 'menuItem.addOnsChange', 'menuItem', id, {
        before: before.addOns,
        after: addOnsOf(item.addOns),
      });
    }
    const fields = changed.filter((k) => k !== 'price' && k !== 'addOns');
    if (fields.length) await audit(req.user, 'menuItem.update', 'menuItem', id, { fields });

    ok(res, item, 'Item updated');
  },
);

menuItemsRouter.delete('/:id', admin, validate(idParams, 'params'), async (req, res) => {
  const item = await findLive(req.params.id);
  item.set({ isDeleted: true, isAvailable: false }); // never hard-delete: past bills reference it
  await item.save();
  await audit(req.user, 'menuItem.delete', 'menuItem', item._id, { name: item.name });
  ok(res, null, 'Item deleted');
});

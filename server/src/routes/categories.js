import { Router } from 'express';
import { z } from 'zod';
import { auth, requireRole } from '../middleware/auth.js';
import { validate, idParams } from '../middleware/validate.js';
import { Category } from '../models/Category.js';
import { MenuItem } from '../models/MenuItem.js';
import { audit } from '../services/audit.js';
import { HttpError, ok } from '../utils/http.js';

export const categoriesRouter = Router();
categoriesRouter.use(auth);
const admin = requireRole('admin');

const name = z.string().trim().min(1, 'Name is required').max(40, 'Name is too long');
const createBody = z.object({ name });
const updateBody = z
  .object({ name: name.optional(), isActive: z.boolean().optional() })
  .refine((b) => b.name !== undefined || b.isActive !== undefined, 'Nothing to update');
const reorderBody = z.object({ ids: z.array(idParams.shape.id).min(1) });
const listQuery = z.object({ active: z.enum(['true', 'false']).optional() });

const dupToConflict = (err) => {
  if (err?.code === 11000) throw new HttpError(409, 'Category already exists');
  throw err;
};

async function findOr404(id) {
  const cat = await Category.findById(id);
  if (!cat) throw new HttpError(404, 'Category not found');
  return cat;
}

categoriesRouter.get('/', validate(listQuery, 'query'), async (req, res) => {
  const activeOnly = req.user.role !== 'admin' || req.validQuery.active === 'true';
  const rows = await Category.aggregate([
    ...(activeOnly ? [{ $match: { isActive: true } }] : []),
    {
      $lookup: {
        from: MenuItem.collection.name,
        let: { cid: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$categoryId', '$$cid'] }, isDeleted: false } },
          { $count: 'n' },
        ],
        as: 'items',
      },
    },
    { $addFields: { itemCount: { $ifNull: [{ $first: '$items.n' }, 0] } } },
    { $project: { items: 0 } },
    { $sort: { sortOrder: 1, name: 1 } },
  ]).collation({ locale: 'en', strength: 2 });
  ok(res, rows);
});

categoriesRouter.post('/', admin, validate(createBody), async (req, res) => {
  const last = await Category.findOne().sort({ sortOrder: -1 }).select('sortOrder').lean();
  const cat = await Category.create({
    name: req.body.name,
    sortOrder: (last?.sortOrder ?? -1) + 1,
  }).catch(dupToConflict);
  await audit(req.user, 'category.create', 'category', cat._id, { name: cat.name });
  ok(res, { ...cat.toObject(), itemCount: 0 }, 'Category created', 201);
});

// Must stay above the /:id routes.
categoriesRouter.post('/reorder', admin, validate(reorderBody), async (req, res) => {
  const { ids } = req.body;
  const existing = new Set((await Category.find().select('_id').lean()).map((c) => String(c._id)));
  const given = new Set(ids.map((id) => id.toLowerCase()));
  if (
    given.size !== ids.length ||
    given.size !== existing.size ||
    [...given].some((id) => !existing.has(id))
  )
    throw new HttpError(422, 'ids must list every category exactly once');
  await Category.bulkWrite(
    ids.map((id, i) => ({
      updateOne: { filter: { _id: id }, update: { $set: { sortOrder: i } } },
    })),
  );
  await audit(req.user, 'category.reorder', 'category', undefined, { ids });
  ok(res, null, 'Order saved');
});

categoriesRouter.patch(
  '/:id',
  admin,
  validate(idParams, 'params'),
  validate(updateBody),
  async (req, res) => {
    const cat = await findOr404(req.params.id);
    const from = { name: cat.name, isActive: cat.isActive };
    cat.set(req.body);
    await cat.save().catch(dupToConflict);
    await audit(req.user, 'category.update', 'category', cat._id, { from, to: req.body });
    ok(res, cat, 'Category updated');
  },
);

categoriesRouter.delete('/:id', admin, validate(idParams, 'params'), async (req, res) => {
  const cat = await findOr404(req.params.id);
  cat.isActive = false;
  await cat.save();
  await audit(req.user, 'category.deactivate', 'category', cat._id, { name: cat.name });
  ok(res, cat, 'Category deactivated');
});

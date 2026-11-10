import { Router } from 'express';
import { z } from 'zod';
import { Table } from '../models/Table.js';
import { auth, requireRole } from '../middleware/auth.js';
import { validate, idParams } from '../middleware/validate.js';
import { HttpError, ok } from '../utils/http.js';
import { audit } from '../services/audit.js';

export const tablesRouter = Router();
tablesRouter.use(auth);

const fields = {
  tableNumber: z.string().trim().min(1, 'Table number is required').max(10),
  capacity: z.number().int().min(1).max(50),
  section: z.string().trim().max(40),
};
// zod strips unknown keys, so status / currentBillId never reach the model.
const createSchema = z.object({ ...fields, section: fields.section.optional() });
const updateSchema = z.object({ ...fields, isActive: z.boolean() }).partial();
const listQuery = z.object({ active: z.enum(['true', 'false']).optional() });

const byNumber = (a, b) => a.tableNumber.localeCompare(b.tableNumber, undefined, { numeric: true });

async function assertUnique(tableNumber, exceptId) {
  const n = tableNumber.toUpperCase();
  if (await Table.exists({ tableNumber: n, _id: { $ne: exceptId } }))
    throw new HttpError(409, `Table ${n} already exists`);
}

tablesRouter.get('/', validate(listQuery, 'query'), async (req, res) => {
  const activeOnly = req.user.role !== 'admin' || req.validQuery.active === 'true';
  const tables = await Table.find(activeOnly ? { isActive: true } : {}).lean();
  ok(res, tables.sort(byNumber));
});

tablesRouter.post('/', requireRole('admin'), validate(createSchema), async (req, res) => {
  await assertUnique(req.body.tableNumber);
  const table = await Table.create(req.body);
  await audit(req.user, 'table.create', 'table', table._id, req.body);
  ok(res, table, `Table ${table.tableNumber} added`, 201);
});

tablesRouter.patch(
  '/:id',
  requireRole('admin'),
  validate(idParams, 'params'),
  validate(updateSchema),
  async (req, res) => {
    const table = await Table.findById(req.params.id);
    if (!table) throw new HttpError(404, 'Table not found');

    const changes = {};
    for (const [k, v] of Object.entries(req.body)) {
      const next = k === 'tableNumber' ? v.toUpperCase() : v;
      if (table[k] !== next) changes[k] = { from: table[k], to: next };
    }

    const inUse = table.status !== 'available' || table.currentBillId;
    if (inUse && (changes.tableNumber || changes.isActive?.to === false))
      throw new HttpError(409, `Table ${table.tableNumber} has an active bill`);
    if (changes.tableNumber) await assertUnique(changes.tableNumber.to, table._id);

    for (const [k, { to }] of Object.entries(changes)) table[k] = to;
    await table.save();

    const { isActive, ...rest } = changes;
    if (isActive)
      await audit(
        req.user,
        isActive.to ? 'table.activate' : 'table.deactivate',
        'table',
        table._id,
      );
    if (Object.keys(rest).length) await audit(req.user, 'table.update', 'table', table._id, rest);

    ok(res, table, `Table ${table.tableNumber} saved`);
  },
);

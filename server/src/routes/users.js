import { Router } from 'express';
import { z } from 'zod';
import { User, ROLES } from '../models/User.js';
import { auth, requireRole } from '../middleware/auth.js';
import { validate, idParams } from '../middleware/validate.js';
import { audit } from '../services/audit.js';
import { HttpError, ok } from '../utils/http.js';

const name = z.string().trim().min(1, 'Name is required').max(80);
const password = z.string().min(8, 'Password must be at least 8 characters').max(128);
const role = z.enum(ROLES, 'Role must be admin, waiter or cashier');
const maxDiscountPercent = z
  .number('Max discount must be a number')
  .min(0, 'Max discount must be 0–100')
  .max(100, 'Max discount must be 0–100');

const createSchema = z.object({
  name,
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'Username must be at least 3 characters')
    .max(40)
    .regex(/^[a-z0-9._-]+$/, 'Username may only contain letters, digits, . _ -'),
  password,
  role,
  maxDiscountPercent: maxDiscountPercent.default(0),
});

const updateSchema = z.object({
  name: name.optional(),
  role: role.optional(),
  maxDiscountPercent: maxDiscountPercent.optional(),
  isActive: z.boolean().optional(),
  password: password.optional(),
  // Reject instead of silently ignoring a username change attempt.
  username: z.undefined('Username cannot be changed').optional(),
});

const listQuery = z.object({
  q: z.string().trim().max(80).optional(),
  role: role.optional(),
});

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const usersRouter = Router();
usersRouter.use(auth, requireRole('admin'));

usersRouter.get('/', validate(listQuery, 'query'), async (req, res) => {
  const { q, role } = req.validQuery;
  const filter = {};
  if (role) filter.role = role;
  if (q) {
    const re = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: re }, { username: re }];
  }
  ok(res, await User.find(filter).sort({ name: 1 }));
});

usersRouter.post('/', validate(createSchema), async (req, res) => {
  const { password, ...fields } = req.body;
  // Pre-check for a friendly message; the unique index still guards races (generic 409).
  if (await User.exists({ username: fields.username })) {
    throw new HttpError(409, 'Username already exists');
  }
  const user = new User(fields);
  await user.setPassword(password);
  await user.save();
  await audit(req.user, 'user.create', 'user', user._id, {
    name: user.name,
    username: user.username,
    role: user.role,
    maxDiscountPercent: user.maxDiscountPercent,
  });
  ok(res, user, 'User created', 201);
});

usersRouter.patch(
  '/:id',
  validate(idParams, 'params'),
  validate(updateSchema),
  async (req, res) => {
    const user = await User.findById(req.params.id).select('+tokenVersion');
    if (!user) throw new HttpError(404, 'User not found');

    const { password, isActive, ...fields } = req.body;
    if (user._id.equals(req.user._id)) {
      if (isActive === false) throw new HttpError(409, 'You cannot deactivate your own account');
      if (fields.role && fields.role !== user.role) {
        throw new HttpError(409, 'You cannot change your own role');
      }
    }

    const changes = {};
    for (const [key, to] of Object.entries(fields)) {
      if (user[key] !== to) changes[key] = { from: user[key], to };
    }
    user.set(fields);

    const statusChanged = isActive !== undefined && isActive !== user.isActive;
    if (statusChanged) user.isActive = isActive;
    if (password) await user.setPassword(password);
    // Kill every refresh token on deactivation or password reset.
    if ((statusChanged && !isActive) || password) user.tokenVersion += 1;

    await user.save();

    const id = user._id;
    if (Object.keys(changes).length) await audit(req.user, 'user.update', 'user', id, changes);
    if (statusChanged) {
      await audit(req.user, isActive ? 'user.activate' : 'user.deactivate', 'user', id, {});
    }
    if (password) await audit(req.user, 'user.passwordReset', 'user', id, {});

    ok(res, user, 'User updated');
  },
);

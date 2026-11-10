import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { User } from '../models/User.js';
import { auth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { HttpError, ok } from '../utils/http.js';

const REFRESH_COOKIE = 'rt';
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const cookieOptions = {
  httpOnly: true,
  secure: config.isProd,
  // Client and API live on different hosts in production → cross-site cookie needs 'none' + secure.
  sameSite: config.isProd ? 'none' : 'lax',
  path: '/api/auth',
};

const JWT_ALG = 'HS256';
const signAccess = (user) =>
  jwt.sign({ sub: user.id, role: user.role, v: user.tokenVersion }, config.JWT_SECRET, {
    algorithm: JWT_ALG,
    expiresIn: config.JWT_EXPIRES_IN,
  });
// Compared against when the user is unknown/inactive so every failed login costs one bcrypt (no timing oracle).
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);

function issueSession(res, user) {
  const refresh = jwt.sign({ sub: user.id, v: user.tokenVersion }, config.JWT_REFRESH_SECRET, {
    algorithm: JWT_ALG,
    expiresIn: REFRESH_TTL_MS / 1000,
  });
  res.cookie(REFRESH_COOKIE, refresh, { ...cookieOptions, maxAge: REFRESH_TTL_MS });
  return { accessToken: signAccess(user), user };
}

/** Returns the user for a valid, unrevoked refresh cookie, else null. */
async function userFromRefresh(req) {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) return null;
  try {
    const { sub, v } = jwt.verify(token, config.JWT_REFRESH_SECRET, { algorithms: [JWT_ALG] });
    const user = await User.findById(sub).select('+tokenVersion');
    return user?.isActive && user.tokenVersion === v ? user : null;
  } catch {
    return null;
  }
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true, // staff share one restaurant IP; only failures count
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, data: null, message: 'Too many failed logins. Try again later.' },
});

const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required').max(200),
});

export const authRouter = Router();

authRouter.post('/login', loginLimiter, validate(loginSchema), async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username }).select('+passwordHash +tokenVersion');
  const valid = user
    ? await user.checkPassword(password)
    : await bcrypt.compare(password, DUMMY_HASH);
  if (!user || !user.isActive || !valid) {
    throw new HttpError(401, 'Invalid username or password');
  }
  ok(res, issueSession(res, user));
});

authRouter.post('/refresh', async (req, res) => {
  const user = await userFromRefresh(req);
  if (!user) {
    res.clearCookie(REFRESH_COOKIE, cookieOptions);
    throw new HttpError(401, 'Session expired');
  }
  ok(res, issueSession(res, user)); // rotates the cookie, sliding the 7-day window
});

authRouter.post('/logout', async (req, res) => {
  const user = await userFromRefresh(req);
  if (user) await User.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 } });
  res.clearCookie(REFRESH_COOKIE, cookieOptions);
  ok(res, null, 'Logged out');
});

authRouter.get('/me', auth, (req, res) => ok(res, req.user));

import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { User } from '../models/User.js';
import { HttpError } from '../utils/http.js';

/** Requires a valid access token; loads the user so deactivation/role/password changes apply immediately. */
export async function auth(req, res, next) {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) throw new HttpError(401, 'Not signed in');

  let payload;
  try {
    payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    throw new HttpError(401, 'Session expired');
  }

  const user = await User.findById(payload.sub).select('+tokenVersion');
  if (!user?.isActive) throw new HttpError(401, 'Account is inactive');
  // Logout / password reset / deactivation bump tokenVersion: old access tokens die immediately too.
  if (payload.v !== user.tokenVersion) throw new HttpError(401, 'Session expired');
  req.user = user;
  next();
}

export const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.user?.role)) throw new HttpError(403, 'You are not allowed to do this');
    next();
  };

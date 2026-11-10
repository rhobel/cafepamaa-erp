import { AuditLog } from '../models/AuditLog.js';

/** audit(req.user, 'menuItem.priceChange', 'menuItem', item._id, { from, to }) */
export const audit = (user, action, entity, entityId, details, { session } = {}) =>
  AuditLog.create([{ userId: user._id, action, entity, entityId, details }], { session });

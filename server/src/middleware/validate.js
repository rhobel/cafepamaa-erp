import { z } from 'zod';

/** Parses req[part] with a zod schema and replaces it with the clean value. Errors → 422 via errorHandler. */
export const validate =
  (schema, part = 'body') =>
  (req, res, next) => {
    const value = schema.parse(req[part]);
    // Express 5 makes req.query a getter; store parsed query separately.
    if (part === 'query') req.validQuery = value;
    else req[part] = value;
    next();
  };

/** Use as: router.patch('/:id', validate(idParams, 'params'), ...) → invalid id gives 422. */
export const idParams = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id') });

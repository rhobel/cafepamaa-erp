import { ZodError } from 'zod';
import { HttpError } from '../utils/http.js';

export const notFound = (req, res) =>
  res
    .status(404)
    .json({ success: false, data: null, message: `Not found: ${req.method} ${req.path}` });

// eslint-disable-next-line no-unused-vars -- Express needs the 4-arg signature
export function errorHandler(err, req, res, next) {
  let status = 500;
  let message = 'Something went wrong';
  let data = null;

  if (err instanceof HttpError) {
    ({ status, message, data } = err);
  } else if (err instanceof ZodError) {
    status = 422;
    message = err.issues[0]?.message ?? 'Invalid input';
    data = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  } else if (err?.code === 11000) {
    status = 409;
    const field = Object.keys(err.keyValue ?? {})[0] ?? 'value';
    message = `That ${field} already exists`;
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    message = 'Malformed JSON body';
  } else if (err?.expose && err.status >= 400 && err.status < 500) {
    // body-parser / http-errors client errors (413 too large, 415 charset...): safe to pass on.
    status = err.status;
    message = err.status === 413 ? 'Request body too large' : 'Bad request';
  }

  if (status >= 500 && !(err instanceof HttpError)) console.error(err); // deliberate 5xx (e.g. 503) are not bugs
  res.status(status).json({ success: false, data, message });
}

export class HttpError extends Error {
  constructor(status, message, data = null) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/** Every response uses { success, data, message }. */
export const ok = (res, data = null, message = '', status = 200) =>
  res.status(status).json({ success: true, data, message });

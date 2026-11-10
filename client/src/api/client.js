const BASE = import.meta.env.VITE_API_URL ?? '/api';

let accessToken = null;
let refreshing = null;
let onSessionLost = () => {};

export class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export const setAccessToken = (t) => (accessToken = t);
export const setSessionLostHandler = (fn) => (onSessionLost = fn);

function send(path, { method = 'GET', body } = {}) {
  return fetch(BASE + path, {
    method,
    credentials: 'include',
    headers: {
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** Uses the httpOnly refresh cookie to get a new access token. Concurrent callers share one request. */
export function refreshSession() {
  refreshing ??= send('/auth/refresh', { method: 'POST' })
    .then(async (res) => {
      if (!res.ok) return null;
      const { data } = await res.json();
      accessToken = data.accessToken;
      return data;
    })
    .catch(() => null)
    .finally(() => (refreshing = null));
  return refreshing;
}

/** Calls the API, unwraps { success, data, message }, retries once after a silent token refresh. */
export async function api(path, options) {
  let res = await send(path, options);

  if (res.status === 401 && !path.startsWith('/auth/')) {
    if (await refreshSession()) {
      res = await send(path, options);
    } else {
      accessToken = null;
      onSessionLost();
    }
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    throw new ApiError(res.status, json.message || `Request failed (${res.status})`, json.data);
  }
  return json.data;
}

// Shared test bootstrap: env, DB connection, an HTTP server on a random port, request helpers.
// Run one file in isolation with its own DB:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:27017/pamaa_test_x node --test test/x.test.js
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGODB_URI_TEST ?? 'mongodb://127.0.0.1:27017/pamaa_test';
process.env.JWT_SECRET ??= 'test-access-secret-test-access-secret-0000';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-test-refresh-secret-00';
process.env.CLIENT_URL ??= 'http://localhost:5173';

const { default: mongoose } = await import('mongoose');
const { createApp } = await import('../src/app.js');
const { User } = await import('../src/models/User.js');

export async function start() {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await mongoose.connection.syncIndexes(); // unique indexes must exist before duplicate tests
  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const stop = async () => {
    server.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  };
  return { base, stop };
}

/** Creates a user directly in the DB. */
export async function makeUser({ username, role, password = 'secret123', ...rest }) {
  const u = new User({ name: username, username, role, ...rest });
  await u.setPassword(password);
  return u.save();
}

/** Logs in and returns a request function bound to that user's token.
 *  const admin = await client(ctx.base, 'admin');
 *  const { status, json } = await admin('POST', '/tables', { tableNumber: 'T1', capacity: 4 }); */
export async function client(base, username, password = 'secret123') {
  const res = await fetch(base + '/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const { data } = await res.json();
  if (!data) throw new Error(`login failed for ${username}`);
  return async (method, path, body) => {
    const r = await fetch(base + path, {
      method,
      headers: {
        authorization: `Bearer ${data.accessToken}`,
        ...(body !== undefined && { 'content-type': 'application/json' }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, json: await r.json() };
  };
}

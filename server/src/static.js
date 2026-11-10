import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

const DIST = path.resolve(import.meta.dirname, '../../client/dist');

/**
 * Single-service mode: serve the built client from the API process (one origin, no CORS).
 * Mount after the /api routes and before notFound. No-op when client/dist hasn't been built.
 */
export function serveClient(app, dist = DIST) {
  const indexHtml = path.join(dist, 'index.html');
  if (!fs.existsSync(indexHtml)) return;

  app.use(
    express.static(dist, {
      index: false,
      setHeaders(res, file) {
        // Vite fingerprints everything under /assets, so it can be cached forever.
        const hashed = file.startsWith(path.join(dist, 'assets') + path.sep);
        res.setHeader('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }),
  );

  // SPA fallback: client-side routes get index.html. /api and missing /assets fall through to notFound.
  app.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) || /^\/(api|assets)(\/|$)/.test(req.path)) {
      return next();
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
}

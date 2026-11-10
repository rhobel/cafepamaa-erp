import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { settingsRouter } from './routes/settings.js';
import { tablesRouter } from './routes/tables.js';
import { categoriesRouter } from './routes/categories.js';
import { menuItemsRouter } from './routes/menuItems.js';
import { uploadsRouter } from './routes/uploads.js';
import { customersRouter } from './routes/customers.js';
import { billsRouter } from './routes/bills.js';
import { checkoutRouter } from './routes/checkout.js';
import { invoicingRouter } from './routes/invoicing.js';
import { invoicesRouter } from './routes/invoices.js';
import { customerProfileRouter } from './routes/customerProfile.js';
import { dashboardRouter } from './routes/dashboard.js';
import { reportsRouter } from './routes/reports.js';
import { errorHandler, notFound } from './middleware/error.js';
import { serveClient } from './static.js';
import { ok } from './utils/http.js';

// Every API router, in mount order. test/security.test.js walks this list to check auth on every route.
export const API_ROUTERS = [
  ['/api/auth', authRouter],
  ['/api/users', usersRouter],
  ['/api/settings', settingsRouter],
  ['/api/tables', tablesRouter],
  ['/api/categories', categoriesRouter],
  ['/api/menu-items', menuItemsRouter],
  ['/api/uploads', uploadsRouter],
  ['/api/customers', customersRouter],
  ['/api/customers', customerProfileRouter], // Sprint 4: search, profile, history
  ['/api/bills', billsRouter],
  ['/api/bills', checkoutRouter], // Sprint 3: checkout, discount calc, void, cancel
  ['/api/bills', invoicingRouter], // Sprint 4: POST /bills/:id/invoice
  ['/api/invoices', invoicesRouter],
  ['/api/dashboard', dashboardRouter],
  ['/api/reports', reportsRouter],
];

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.isProd) app.set('trust proxy', 1); // real client IP behind the host's proxy (rate limiting)

  // Menu images and the invoice logo are Cloudinary / pasted https URLs; everything else stays 'self'.
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { 'img-src': ["'self'", 'data:', 'https:'] } },
    }),
  );
  app.use(cors({ origin: config.CLIENT_URL, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  if (config.NODE_ENV !== 'test') app.use(morgan(config.isProd ? 'combined' : 'dev'));

  app.get('/api/health', (req, res) => ok(res, { status: 'ok' })); // before the limiter: uptime monitor + Docker HEALTHCHECK

  // Generous: every staff device in the restaurant shares one public IP. Login has its own stricter limiter.
  app.use(
    '/api',
    rateLimit({
      windowMs: 60 * 1000,
      limit: 1200,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { success: false, data: null, message: 'Too many requests. Please slow down.' },
    }),
  );
  for (const [path, router] of API_ROUTERS) app.use(path, router);

  serveClient(app); // single-service prod: built client + SPA fallback (no-op without client/dist)

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

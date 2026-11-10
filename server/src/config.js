import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(5050),
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  // CORS compares the Origin header exactly, and browsers never send a trailing slash.
  CLIENT_URL: z
    .string()
    .url()
    .transform((s) => s.replace(/\/+$/, '')),
  // Optional: without these, image upload returns 503 and the UI accepts a pasted URL.
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
});

const parsed = schema
  .refine((e) => e.NODE_ENV !== 'production' || e.JWT_SECRET !== e.JWT_REFRESH_SECRET, {
    message: 'JWT_SECRET and JWT_REFRESH_SECRET must differ in production',
    path: ['JWT_REFRESH_SECRET'],
  })
  // localhost allowed so a production build can be smoke-tested locally (e.g. docker run).
  .refine(
    (e) =>
      e.NODE_ENV !== 'production' || /^(https:\/\/|http:\/\/localhost([:/]|$))/.test(e.CLIENT_URL),
    {
      message: 'CLIENT_URL must be https in production',
      path: ['CLIENT_URL'],
    },
  )
  .safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:\n' + z.prettifyError(parsed.error));
  process.exit(1);
}

export const config = { ...parsed.data, isProd: parsed.data.NODE_ENV === 'production' };

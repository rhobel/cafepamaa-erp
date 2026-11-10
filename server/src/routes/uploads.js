import { createHash } from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { auth, requireRole } from '../middleware/auth.js';
import { HttpError, ok } from '../utils/http.js';

// Signed direct-to-Cloudinary upload: the browser sends the file to Cloudinary, we only store the URL.
export const uploadsRouter = Router();

uploadsRouter.post('/sign', auth, requireRole('admin'), (req, res) => {
  const {
    CLOUDINARY_CLOUD_NAME: cloudName,
    CLOUDINARY_API_KEY: apiKey,
    CLOUDINARY_API_SECRET: secret,
  } = config;
  if (!cloudName || !apiKey || !secret) {
    throw new HttpError(503, 'Image upload is not configured. Paste an image URL instead.');
  }
  const folder = 'pamaa';
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHash('sha1')
    .update(`folder=${folder}&timestamp=${timestamp}${secret}`)
    .digest('hex');
  ok(res, { cloudName, apiKey, folder, timestamp, signature });
});

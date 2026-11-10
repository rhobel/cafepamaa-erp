// Creates the first admin. Refuses to run if any admin already exists.
// Usage: SEED_ADMIN_USERNAME=admin SEED_ADMIN_PASSWORD=... npm run seed:admin
import mongoose from 'mongoose';
import { config } from '../config.js';
import { User } from '../models/User.js';

const username = process.env.SEED_ADMIN_USERNAME?.trim().toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD;

if (!username || !password || password.length < 8) {
  console.error('Set SEED_ADMIN_USERNAME and SEED_ADMIN_PASSWORD (min 8 chars).');
  process.exit(1);
}

await mongoose.connect(config.MONGODB_URI);
try {
  if (await User.exists({ role: 'admin' })) {
    console.error('An admin already exists. Nothing done.');
    process.exitCode = 1;
  } else {
    const admin = new User({
      name: 'Administrator',
      username,
      role: 'admin',
      maxDiscountPercent: 100,
    });
    await admin.setPassword(password);
    await admin.save();
    console.log(`Admin "${username}" created. Change this password after first login.`);
  }
} finally {
  await mongoose.disconnect();
}

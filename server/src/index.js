import mongoose from 'mongoose';
import { config } from './config.js';
import { createApp } from './app.js';

await mongoose.connect(config.MONGODB_URI);
console.log('MongoDB connected');

const server = createApp().listen(config.PORT, () =>
  console.log(`API listening on http://localhost:${config.PORT}`),
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => mongoose.disconnect().then(() => process.exit(0))));
}

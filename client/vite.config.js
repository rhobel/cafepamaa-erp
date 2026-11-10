import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180, // 5173 is often taken by other Vite apps; fail loudly instead of drifting
    strictPort: true,
    proxy: { '/api': 'http://localhost:5050' }, // not 5000: macOS AirPlay listens there
  },
});

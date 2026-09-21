import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// Development uses the same authentication as production. No fake user or
// project, injected project token or organization-specific host is built in.
export default defineConfig({
  plugins: [preact()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  server: { proxy: {
    '/api': {target:process.env.GRADULA_DEV_TARGET ?? 'http://127.0.0.1:3200'},
    '/auth': {target:process.env.GRADULA_DEV_TARGET ?? 'http://127.0.0.1:3200'},
  } },
});

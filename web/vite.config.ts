import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const token = process.env.LOCAL_KEY ?? '';
const project = process.env.LOCAL_PROJECT ?? 'MDLA';

/** Local viewing only: stands in for the sign-in the board asks for. */
const asPerson = {
  name: 'as-person',
  configureServer(server: any) {
    server.middlewares.use((req: any, res: any, next: any) => {
      const url = String(req.url ?? '');
      if (url.startsWith('/api/v1/me')) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ kind: 'human', name: 'David Bläsing', sub: 'local', roles: ['dev'] }));
        return;
      }
      if (url.startsWith('/api/v1/projects')) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify([{ key: project, name: project, repo: null }]));
        return;
      }
      next();
    });
  },
};

const withKey = {
  target: 'http://127.0.0.1:3399',
  changeOrigin: true,
  configure: (proxy: any) => {
    proxy.on('proxyReq', (req: any) => { if (token) req.setHeader('authorization', `Bearer ${token}`); });
  },
};

export default defineConfig({
  plugins: [asPerson, react()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  server: { proxy: { '/api': withKey, '/auth': withKey } },
});

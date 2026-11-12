import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': fileURLToPath(new URL('../src/shared', import.meta.url)) } },
  // API_TARGET lets `npm run dev:mock` point the preview at the sample-data mock instead of the bot.
  server: { proxy: { '/api': process.env.API_TARGET ?? 'http://localhost:3000', '/health': process.env.API_TARGET ?? 'http://localhost:3000' } },
  build: { outDir: 'dist', emptyOutDir: true },
});

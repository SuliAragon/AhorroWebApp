import { defineConfig } from 'astro/config';
import { buildOfflineApp } from './scripts/offline.mjs';

export default defineConfig({
  output: 'static',
  base: process.env.WEBAPP_BASE || '/',
  trailingSlash: 'always',
  integrations: [buildOfflineApp()],
});

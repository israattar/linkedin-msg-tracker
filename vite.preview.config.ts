// Serves the renderer alone in a plain browser for UI development, using the
// in-memory mock in src/renderer/src/lib/api.ts. The real app (npm run dev)
// uses electron-vite and does not read this file.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(projectDir, 'src/renderer'),
  plugins: [react()],
  server: { port: 5199, strictPort: true },
});

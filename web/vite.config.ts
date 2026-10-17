import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Frontend de la Fase 6: se compila a web/dist y lo sirve el mismo servidor en /app (src/web.ts).
// En desarrollo (npm run dev:web) las llamadas a /api van al servidor local.
export default defineConfig({
  root: import.meta.dirname,
  base: '/app/',
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { proxy: { '/api': 'http://localhost:3000' } },
});

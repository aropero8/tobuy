import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' para que las rutas funcionen dentro del WebView de Capacitor
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    // Open Food Facts no manda cabeceras CORS: en `npm run dev` se le pregunta a través de Vite
    // (en Android se usa CapacitorHttp, ver src/photos.js)
    proxy: {
      '/off': {
        target: 'https://search.openfoodfacts.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/off/, ''),
        headers: { 'User-Agent': 'ToBuy/1.0 (https://github.com/aropero8/tobuy)' },
      },
    },
  },
});

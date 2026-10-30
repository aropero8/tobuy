import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Service worker de la versión web (GitHub Pages): guarda todos los ficheros de la app para que abra sin
// conexión (en el súper puede no haber cobertura). Se genera al compilar con la lista de ficheros de dist/;
// cada versión usa su propia caché y borra las anteriores. En Android (Capacitor) no se registra.
function serviceWorker() {
  let outDir;
  return {
    name: 'tobuy-sw',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const files = [];
      const walk = (dir) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const p = join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else if (e.name !== 'sw.js') files.push(relative(outDir, p).replaceAll('\\', '/'));
        }
      };
      walk(outDir);
      files.sort();
      const template = readFileSync('src/sw.js', 'utf8');
      const hash = createHash('sha256').update(template);
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 12);
      const sw = template
        .replace('__VERSION__', version)
        .replace('__FILES__', JSON.stringify(['./', ...files]));
      writeFileSync(join(outDir, 'sw.js'), sw);
    },
  };
}

// base './' para que las rutas funcionen dentro del WebView de Capacitor (y en github.io/tobuy/)
export default defineConfig({
  plugins: [react(), serviceWorker()],
  base: './',
  build: {
    chunkSizeWarningLimit: 800, // Firebase ocupa lo suyo; es una sola pantalla y en la web queda en caché
  },
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

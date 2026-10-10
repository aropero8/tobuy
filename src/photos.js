// Fotos de productos: búsqueda en internet y miniaturas para guardar en el móvil.
//   - Open Food Facts (search.openfoodfacts.org): fotos de productos envasados de España (Hacendado, Dia…).
//     No manda cabeceras CORS: en Android se pide con CapacitorHttp (nativo) y en `npm run dev`, por el
//     proxy /off de vite.config.js.
//   - Wikipedia en español: fotos genéricas (fruta, verdura, pan…).
// Las fotos se guardan como miniatura JPEG en data URL, para verlas sin conexión dentro del súper.
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { norm } from './parseVoice.js';

const native = Capacitor.isNativePlatform();
const UA = 'ToBuy/1.0 (https://github.com/aropero8/tobuy)';

async function getJson(url, devUrl) {
  if (native) {
    const r = await CapacitorHttp.get({ url, headers: { 'User-Agent': UA }, connectTimeout: 8000, readTimeout: 8000 });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
  }
  const r = await fetch(devUrl ?? url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function searchOpenFoodFacts(query) {
  const params = new URLSearchParams({
    q: `${query} countries_tags:"en:spain"`,
    langs: 'es',
    page_size: '12',
    fields: 'code,product_name,brands,image_front_small_url',
  });
  const path = `/search?${params}`;
  const data = await getJson(`https://search.openfoodfacts.org${path}`, import.meta.env.DEV ? `/off${path}` : null);
  return (data.hits ?? [])
    .filter((h) => h.image_front_small_url)
    .map((h) => ({
      url: h.image_front_small_url,
      label: [h.product_name, [h.brands ?? []].flat()[0]].filter(Boolean).join(' · '),
    }));
}

async function searchWikipedia(query) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', generator: 'search', gsrsearch: query, gsrlimit: '8',
    prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '250',
  });
  const stem = norm(query).slice(0, 5);
  const data = await getJson(`https://es.wikipedia.org/w/api.php?${params}`);
  return Object.values(data.query?.pages ?? {})
    // Solo artículos que empiecen como el producto: «Plátano de Canarias» sí, «Estación Plátanos» o «Plátanos (Heraclión)» no
    .filter((p) => p.thumbnail?.source && !p.title.includes('(') && norm(p.title).startsWith(stem))
    .sort((a, b) => a.index - b.index)
    .slice(0, 4)
    .map((p) => ({ url: p.thumbnail.source, label: p.title }));
}

// Primero lo genérico de Wikipedia (suele acertar con «plátanos» o «pan») y luego los productos.
// Si una fuente falla (sin conexión, límite de peticiones) se usan las demás.
export async function searchPhotos(query) {
  const [wiki, off] = await Promise.allSettled([searchWikipedia(query), searchOpenFoodFacts(query)]);
  const results = [...(wiki.value ?? []), ...(off.value ?? [])];
  if (!results.length && wiki.status === 'rejected' && off.status === 'rejected') throw new Error('offline');
  const seen = new Set();
  return results.filter((r) => !seen.has(r.url) && seen.add(r.url));
}

const MAX = 240; // lado mayor de la miniatura guardada, en px

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // para poder leer los píxeles de una foto de internet
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image'));
    img.src = src;
  });
}

// Miniatura JPEG (data URL) de una foto de internet o de un fichero (cámara/galería)
export async function makeThumb(source) {
  const isFile = source instanceof Blob;
  const src = isFile ? URL.createObjectURL(source) : source;
  try {
    const img = await loadImage(src);
    const k = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * k);
    canvas.height = Math.round(img.naturalHeight * k);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // los PNG con transparencia quedan sobre blanco
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.75);
  } finally {
    if (isFile) URL.revokeObjectURL(src);
  }
}

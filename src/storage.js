import { brandOf } from './brands.js';

// Guardado local. localStorage funciona dentro del WebView de Capacitor.
// Si más adelante quieres algo más robusto, cámbialo por @capacitor/preferences.
// v2 añadió `photos`; si no hay datos v2 se leen los de v1 (que se dejan como estaban, por si acaso).
const KEY = 'lista-compra-v2';
const OLD_KEY = 'lista-compra-v1';

const CARREFOUR_ROJO_ANTIGUO = '#c8102e';
const CARREFOUR_AZUL = '#004e9f';

// Ahorramás se añadió a los súper por defecto (oct. 2026). A las listas que ya existían se les añade una sola vez
// (apuntado en AHORRAMAS_KEY, fuera del estado, al guardar), para que no vuelva a salir si el usuario lo borra.
// loadState no lo apunta: tiene que dar lo mismo cada vez que se llame (React lo llama dos veces en desarrollo).
const AHORRAMAS = { id: 'ahorramas', name: 'Ahorramás', color: '#e2231a' };
const AHORRAMAS_KEY = 'tobuy-ahorramas-anadido';

const DEFAULT_STATE = {
  stores: [
    { id: 'mercadona', name: 'Mercadona', color: '#1f7a4d' },
    { id: 'lidl', name: 'Lidl', color: '#0050aa' },
    { id: 'carrefour', name: 'Carrefour', color: CARREFOUR_AZUL },
    { id: 'dia', name: 'Dia', color: '#e4002b' },
    AHORRAMAS,
  ],
  items: [], // { id, name, qty, storeId, done, createdAt }
  photos: {}, // norm(nombre del producto) → miniatura en data URL (o la URL, si no se pudo copiar)
};

// Migraciones de valores guardados. No cambian la forma del estado, así que no hace falta subir la clave.
// Carrefour pasó del rojo antiguo al azul: solo se cambia si sigue con ese rojo exacto.
function migrateStores(stores) {
  return stores.map((s) =>
    (s.id === 'carrefour' || s.name?.trim().toLowerCase() === 'carrefour') &&
    s.color?.toLowerCase() === CARREFOUR_ROJO_ANTIGUO
      ? { ...s, color: CARREFOUR_AZUL }
      : s
  );
}

function addAhorramasOnce(stores) {
  if (localStorage.getItem(AHORRAMAS_KEY)) return stores;
  return stores.some((s) => brandOf(s.name)?.keys.includes('ahorramas') || s.id === AHORRAMAS.id)
    ? stores
    : [...stores, AHORRAMAS];
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw);
    return {
      stores: addAhorramasOnce(migrateStores(parsed.stores ?? DEFAULT_STATE.stores)),
      items: parsed.items ?? [],
      photos: parsed.photos ?? {},
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    localStorage.setItem(AHORRAMAS_KEY, '1'); // ya guardado con Ahorramás (o sin él, si lo borró)
    return true;
  } catch {
    return false; // sin espacio (demasiadas fotos) o almacenamiento bloqueado
  }
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

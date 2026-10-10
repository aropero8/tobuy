// Convierte una frase dictada en un producto:
//   «queso carrefour»                      → { name: 'Queso', qty: '', storeId: 'carrefour' }
//   «apunta 2 kilos de naranjas en el Lidl» → { name: 'Naranjas', qty: '2 kilos', storeId: 'lidl' }
// Si no se nombra ningún súper, storeId es null y decide la pantalla.

// Minúsculas, sin tildes ni signos: «Día,» → «dia»
export const norm = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// Palabras que sobran delante del súper («en el Lidl», «para Mercadona»)
const BEFORE_STORE = new Set(['en', 'el', 'la', 'los', 'las', 'de', 'del', 'al', 'a', 'para']);
// Órdenes y muletillas al principio («apunta», «hace falta», «necesito»)
const FILLERS = new Set([
  'anade', 'anadir', 'anademe', 'apunta', 'apuntar', 'apuntame', 'pon', 'ponme', 'poner', 'compra', 'comprar',
  'agrega', 'agregar', 'mete', 'meter', 'necesito', 'necesitamos', 'quiero', 'hay', 'que', 'hace', 'falta',
  'faltan', 'me', 'tambien', 'y',
]);
// Artículos al principio del nombre («unas galletas» → «galletas»)
const ARTICLES = new Set(['un', 'una', 'unos', 'unas', 'el', 'la', 'los', 'las', 'algo', 'de', 'del']);

const NUMBERS = { un: '1', uno: '1', una: '1', medio: 'medio', media: 'media', dos: '2', tres: '3', cuatro: '4',
  cinco: '5', seis: '6', siete: '7', ocho: '8', nueve: '9', diez: '10', once: '11', doce: '12' };
// «un», «medio»… solo son cantidad si van con unidad («un kilo de»); si no, son artículos («un queso»)
const NEEDS_UNIT = new Set(['un', 'uno', 'una', 'medio', 'media']);
const UNITS = new Set([
  'kilo', 'kilos', 'kg', 'g', 'gr', 'gramo', 'gramos', 'litro', 'litros', 'l', 'ml', 'paquete', 'paquetes',
  'bote', 'botes', 'lata', 'latas', 'botella', 'botellas', 'caja', 'cajas', 'bolsa', 'bolsas', 'docena',
  'docenas', 'barra', 'barras', 'tarro', 'tarros', 'brick', 'bricks', 'pack', 'packs', 'unidad', 'unidades',
  'bandeja', 'bandejas', 'sobre', 'sobres', 'rollo', 'rollos', 'tableta', 'tabletas', 'pieza', 'piezas',
]);

const stripPunct = (s) => s.replace(/^[\s.,;:!?¡¿"'«»-]+|[\s.,;:!?¡¿"'«»-]+$/g, '');

// Súper nombrado en la frase. Se compara pegando palabras para que «Ahorra Más» encaje con «Ahorramas».
// Si salen varios, gana el que acaba más tarde («pan del día en Mercadona» → Mercadona).
function findStore(words, stores) {
  let best = null;
  for (const s of stores) {
    const key = s.name.split(/\s+/).map(norm).join('');
    if (!key) continue;
    for (let i = 0; i < words.length; i++) {
      let joined = '';
      for (let j = i; j < words.length && joined.length < key.length; j++) {
        joined += words[j].n;
        if (joined === key && (!best || j > best.end || (j === best.end && key.length > best.len)))
          best = { id: s.id, start: i, end: j, len: key.length };
      }
    }
  }
  return best;
}

// Cantidad al principio: «2 leches», «2 kilos de», «2kg de», «medio kilo de», «una docena de»
function takeQty(words) {
  const [first, second] = words;
  if (!first) return '';
  const raw = stripPunct(first.w);
  const glued = raw.match(/^(\d+(?:[.,]\d+)?)([a-zA-Z]+)$/);
  let qty = '';
  let used = 0;
  if (glued && UNITS.has(norm(glued[2]))) {
    qty = `${glued[1]} ${glued[2]}`;
    used = 1;
  } else {
    const num = /^\d+(?:[.,]\d+)?$/.test(raw) ? raw : NUMBERS[first.n];
    const unit = second && UNITS.has(second.n) ? stripPunct(second.w) : '';
    if (!num || (!unit && NEEDS_UNIT.has(first.n)) || words.length < 2) return '';
    qty = unit ? `${num} ${unit}` : num;
    used = unit ? 2 : 1;
  }
  words.splice(0, used);
  if (words[0]?.n === 'de' && qty.includes(' ')) words.shift();
  return qty;
}

function parsePhrase(text, stores) {
  let words = text.trim().split(/\s+/).map((w) => ({ w, n: norm(w) })).filter((t) => t.n);

  const store = findStore(words, stores);
  if (store) {
    let start = store.start;
    while (start > 0 && BEFORE_STORE.has(words[start - 1].n)) start--;
    words = [...words.slice(0, start), ...words.slice(store.end + 1)];
  }

  while (words.length && FILLERS.has(words[0].n)) words.shift();
  const last = words.length - 1;
  if (words[last]?.n === 'favor' && words[last - 1]?.n === 'por') words.splice(-2);

  const qty = takeQty(words);
  while (words.length > 1 && ARTICLES.has(words[0].n)) words.shift();

  const name = stripPunct(words.map((t) => t.w).join(' '));
  return { name: name.charAt(0).toUpperCase() + name.slice(1), qty, storeId: store?.id ?? null };
}

// Recibe las alternativas del reconocedor (la más probable primero): se queda con la primera que
// nombre un súper (a veces solo una alternativa lo entiende bien); si ninguna lo nombra, la primera.
export function parseVoice(matches, stores) {
  const parsed = matches.map((m) => parsePhrase(m, stores));
  return (
    parsed.find((p) => p.name && p.storeId) ?? parsed.find((p) => p.name) ?? { name: '', qty: '', storeId: null }
  );
}

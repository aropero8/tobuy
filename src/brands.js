// Logos de supermercados conocidos. Se buscan por el nombre del súper al pintar (no se guardan en el estado),
// así que un súper añadido a mano como «Carrefour Express» también sale con su logo.
//   logo: logotipo completo (tarjetas, cabecera)
//   mark: símbolo cuadrado para los sitios pequeños (chips, avisos); sin él se pinta la inicial
//   scale: tamaño del logo respecto al hueco (los macizos y compactos, como el de Dia, pesan más a igual tamaño)
// Los logotipos son marcas de sus propietarios (ver README).
import { norm } from './parseVoice.js';
import mercadona from './assets/stores/mercadona.png';
import mercadonaMark from './assets/stores/mercadona-mark.png';
import lidl from './assets/stores/lidl.svg';
import carrefour from './assets/stores/carrefour.svg';
import carrefourMark from './assets/stores/carrefour-mark.svg';
import dia from './assets/stores/dia.svg';
import aldi from './assets/stores/aldi.svg';
import eroski from './assets/stores/eroski.svg';
import eroskiMark from './assets/stores/eroski-mark.svg';
import hipercor from './assets/stores/hipercor.svg';
import elcorteingles from './assets/stores/elcorteingles.svg';
import spar from './assets/stores/spar.svg';
import sparMark from './assets/stores/spar-mark.svg';
import gadis from './assets/stores/gadis.svg';
import froiz from './assets/stores/froiz.svg';
import caprabo from './assets/stores/caprabo.svg';

// keys: nombres normalizados (sin espacios ni tildes) que cuentan como ese súper
export const BRANDS = [
  { keys: ['mercadona'], name: 'Mercadona', color: '#1f7a4d', logo: mercadona, mark: mercadonaMark },
  { keys: ['lidl'], name: 'Lidl', color: '#0050aa', logo: lidl, mark: lidl },
  { keys: ['carrefour'], name: 'Carrefour', color: '#004e9f', logo: carrefour, mark: carrefourMark },
  { keys: ['dia'], name: 'Dia', color: '#e4002b', logo: dia, mark: dia, scale: 0.78 },
  { keys: ['aldi'], name: 'Aldi', color: '#1c3d8f', logo: aldi, mark: aldi },
  { keys: ['eroski'], name: 'Eroski', color: '#e42219', logo: eroski, mark: eroskiMark },
  { keys: ['elcorteingles', 'corteingles'], name: 'El Corte Inglés', color: '#008657', logo: elcorteingles,
    mark: elcorteingles },
  { keys: ['hipercor'], name: 'Hipercor', color: '#353a90', logo: hipercor },
  { keys: ['spar'], name: 'Spar', color: '#157946', logo: spar, mark: sparMark },
  { keys: ['gadis'], name: 'Gadis', color: '#d52b1e', logo: gadis },
  { keys: ['froiz'], name: 'Froiz', color: '#e2001a', logo: froiz },
  { keys: ['caprabo'], name: 'Caprabo', color: '#1aa0d8', logo: caprabo },
];

// Marca de un súper por su nombre: vale el nombre entero o sus primeras palabras
// («Carrefour Market» → Carrefour, «Día» → Dia), pero no «Diamante» ni «Supermercados Dia»
export function brandOf(name = '') {
  const words = name.split(/\s+/).map(norm).filter(Boolean);
  let joined = '';
  for (const w of words) {
    joined += w;
    const brand = BRANDS.find((b) => b.keys.includes(joined));
    if (brand) return brand;
  }
  return null;
}

// Reconocimiento de voz. En Android usa el plugin nativo propio «Voice»
// (android/app/src/main/java/com/alberto/carrito/VoicePlugin.java; el WebView no trae la Web Speech API).
// En el navegador (npm run dev) usa la Web Speech API si existe (Chrome, Edge).
// Si no hay ninguno, voiceAvailable() da false y no se muestra el micrófono.
import { Capacitor, registerPlugin } from '@capacitor/core';

const LANG = 'es-ES';
const native = Capacitor.isNativePlatform();
const Voice = registerPlugin('Voice');
const WebRecognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;

const MESSAGES = {
  permission: 'Sin permiso de micrófono. Puedes darlo en Ajustes',
  nomatch: 'No te he entendido. Prueba otra vez',
  network: 'Sin conexión para reconocer la voz',
  failed: 'No se ha podido usar el micrófono',
};
// Errores de la Web Speech API → códigos del plugin nativo
const WEB_ERRORS = { 'no-speech': 'nomatch', aborted: 'nomatch', network: 'network', 'not-allowed': 'permission',
  'service-not-allowed': 'permission' };

// El mensaje del error ya es el texto que se enseña al usuario
const fail = (code) => Object.assign(new Error(MESSAGES[code] ?? MESSAGES.failed), { voice: true });

let availability;
export function voiceAvailable() {
  availability ??= native
    ? Voice.available().then((r) => r.available, () => false)
    : Promise.resolve(!!WebRecognition);
  return availability;
}

// Escucha una frase y devuelve las alternativas reconocidas, la más probable primero.
// Mientras escucha avisa con onPartial(texto provisional) y, solo en Android, onLevel(volumen de 0 a 1).
// Si falla, el error trae en `message` el aviso para el usuario.
export async function listen({ onPartial, onLevel } = {}) {
  let matches;
  const subs = [];
  try {
    if (native) {
      if (onPartial) subs.push(await Voice.addListener('partial', (e) => onPartial(e.text)));
      // rmsdB va más o menos de -2 (silencio) a 10 (voz alta)
      if (onLevel) subs.push(await Voice.addListener('level', (e) => onLevel(Math.min(1, Math.max(0, (e.level + 2) / 12)))));
    }
    matches = native ? (await Voice.listen({ language: LANG })).matches : await listenWeb(onPartial);
  } catch (e) {
    throw e.voice ? e : fail(e.code);
  } finally {
    subs.forEach((s) => s.remove());
  }
  if (!matches?.length) throw fail('nomatch');
  return matches;
}

let webRec = null;

function listenWeb(onPartial) {
  return new Promise((resolve, reject) => {
    const rec = new WebRecognition();
    rec.lang = LANG;
    rec.maxAlternatives = 5;
    rec.interimResults = !!onPartial;
    let matches = [];
    rec.onresult = (e) => {
      // El resultado provisional solo trae una alternativa; si se corta antes del final, se usa ese
      matches = Array.from(e.results[0], (alt) => alt.transcript);
      if (!e.results[0].isFinal) onPartial?.(Array.from(e.results, (r) => r[0].transcript).join(''));
    };
    rec.onerror = (e) => reject(fail(WEB_ERRORS[e.error]));
    rec.onend = () => {
      webRec = null;
      resolve(matches);
    };
    webRec = rec;
    rec.start();
  });
}

// Deja de escuchar ya; lo que se haya dicho hasta ahora se reconoce igualmente
export function stopListening() {
  if (native) Voice.stop().catch(() => {});
  else webRec?.stop();
}

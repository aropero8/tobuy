# CLAUDE.md — ToBuy (lista de la compra)

Contexto del proyecto para Claude Code. Léelo antes de tocar nada.

## Qué es
App personal de lista de la compra organizada **por supermercado**. El usuario elige a qué súper va y ve solo lo que tiene apuntado para ese sitio. Desde la pantalla inicial se pueden añadir productos rápido eligiendo el súper.

Objetivo final: **app Android** empaquetada con **Capacitor**. Uso personal; el repo es **público en GitHub** con licencia **GPL-3.0-or-later** (`LICENSE`), así que se mantiene ordenado y sin datos sensibles.

La app se llamaba «Carrito» y pasó a llamarse **ToBuy** (oct. 2026). Solo cambió el nombre visible: el `appId`/paquete Android sigue siendo `com.alberto.carrito` y la carpeta local sigue siendo `carrito`. El repo de GitHub se renombró de `carrito` a `tobuy` (GitHub redirige la dirección antigua). **No cambiar el `appId`**: Android la trataría como otra app y se perderían los datos guardados (localStorage va ligado a la app).

## Stack
- React 18 + Vite 6 (JavaScript, sin TypeScript)
- Capacitor 7 (`@capacitor/core`, `@capacitor/android`, `@capacitor/cli`, `@capacitor/app` para el botón atrás, `@capacitor/status-bar` para la barra de estado) + un plugin nativo propio, `VoicePlugin`, para el dictado por voz
- CSS plano en `src/App.css` (sin librerías de UI), con modo claro/oscuro vía `prefers-color-scheme`
- Sin backend: datos solo en el dispositivo

## Estructura
```
index.html               entrada Vite (viewport-fit=cover para notch/safe areas)
vite.config.js           base: './'  ← obligatorio para que funcione en el WebView de Capacitor; proxy /off (fotos en dev)
capacitor.config.json    appId com.alberto.carrito, appName ToBuy, webDir dist, config de StatusBar
.claude/launch.json      servidor de desarrollo para las vistas previas de Claude Code (puerto 5181)
src/main.jsx             monta <App/>
src/App.jsx              App (estado global y escucha de voz) + HomeScreen/StoreCard/AddStoreSheet + StoreScreen
                         + VoiceButton/VoiceOverlay + Sheet (hoja inferior) + StoreMark/StoreLogo (logos)
src/brands.js            logos de súper conocidos (BRANDS) y brandOf(nombre)
src/assets/stores/       logotipos (SVG/PNG) que usa brands.js
src/storage.js           loadState/saveState en localStorage (clave 'lista-compra-v2'), uid(), supermercados por defecto
src/photos.js            fotos de productos: searchPhotos(nombre) (Wikipedia + Open Food Facts) y makeThumb(url|fichero)
src/voice.js             reconocimiento de voz: voiceAvailable(), listen({ onPartial, onLevel }), stopListening()
src/parseVoice.js        parseVoice(alternativas, stores) → { name, qty, storeId|null } (función pura); exporta norm()
src/App.css              estilos
android/                 proyecto nativo generado por Capacitor (minSdk 23, targetSdk 35)
  app/src/main/java/com/alberto/carrito/VoicePlugin.java   plugin propio de voz (registrado en MainActivity)
assets/icon-only.svg     diseño del icono (carrito blanco sobre #1f7a4d)
```

## Icono de la app
- **Android 8+ (adaptativo)**: `res/mipmap-anydpi-v26/ic_launcher*.xml` → fondo `@color/ic_launcher_background` (`#1F7A4D`, en `values/`) + primer plano vectorial `res/drawable-v24/ic_launcher_foreground.xml` (también capa `monochrome` para iconos temáticos). Es el mismo dibujo que el SVG, en sus coordenadas de 1024 con dos `group` de transformación; las ranuras de la cesta son huecos de un `clip-path`.
- **Android < 8**: PNG `mipmap-*/ic_launcher.png` y `ic_launcher_round.png`, generados desde `assets/icon-only.svg` con `npx @capacitor/assets@3.0.5 generate --android`. Después, **revertir `AndroidManifest.xml`** (la herramienta lo reformatea sin cambiar nada).
- **No poner `icon-foreground`/`icon-background` en `assets/`**: la herramienta generaría las capas adaptativas en PNG a tamaño de 48 dp (bug suyo: se ven borrosas) y sobrescribiría los XML de `mipmap-anydpi-v26`.
- Si se cambia el dibujo, cambiar el SVG **y** el vector. Ojo: en los comentarios de un SVG no puede haber `--` (rompe el XML y la herramienta lo ignora).
- El splash de Android ≤ 11 (`drawable*/splash.png`) sigue siendo el de la plantilla de Capacitor; en Android 12+ el sistema muestra el icono de la app.

## Logos de supermercados
- `brands.js` asocia nombres a logos: `brandOf(nombre)` normaliza (sin tildes, mayúsculas ni espacios) y prueba el nombre entero y sus primeras palabras («Carrefour Market» → Carrefour, «Día» → Dia; «Supermercados Dia» no). **No se guarda nada en el estado**: el logo sale del nombre al pintar, así que no hay migración.
- Cada marca tiene `logo` (logotipo completo: tarjetas del inicio, placa blanca de la cabecera del súper), `mark` opcional (símbolo cuadrado: chips, avisos, hoja de mover; sin él se pinta la inicial sobre el color del súper), `color` (el que recibe un súper nuevo con ese nombre) y `scale` opcional (el de Dia, macizo, se pinta al 78 %).
- Marcas incluidas: las 4 por defecto + Aldi, Eroski, El Corte Inglés, Hipercor, Spar, Gadis, Froiz y Caprabo (salen como sugerencias al añadir súper). Un súper sin logo se ve con su nombre en grande.
- Procedencia: Carrefour, el SVG de su web (`carrefour.es`, «imagotipo»); el resto, de Wikimedia Commons (marcados allí como dominio público por ser logotipos simples, pero son marcas registradas). Mercadona es el PNG oficial con la cesta (`Logo Mercadona (color-300-alpha).png`), reducido a la mitad; `mercadona-mark.png` es la cesta recortada. Los SVG se limpiaron (sin metadatos de Inkscape/Illustrator, con `viewBox`); los `*-mark.svg` son el mismo SVG con el `viewBox` recortado al símbolo. Se revisó que no llevan scripts.
- **No están bajo la GPL**: el README lo avisa. Si se añade un logo, que sea de una fuente así y sin scripts; en un SVG con `inkscape:`/`sodipodi:` hay que quitar esos elementos y atributos (sin su espacio de nombres el SVG no carga).
- Los logos se pintan siempre sobre blanco (también en modo oscuro), porque muchos no se leen sobre fondo oscuro.

## Modelo de datos
```js
state = {
  stores: [{ id, name, color }],                         // por defecto: Mercadona, Lidl, Carrefour (azul #004e9f), Dia
  items:  [{ id, name, qty, storeId, done, createdAt }]   // qty es texto libre ("2", "1 kg"...)
  photos: { [norm(nombre)]: 'data:image/jpeg;base64,…' }  // foto por nombre de producto (ver «Fotos de productos»)
}
```
- Todo el estado vive en `App` y se persiste con un `useEffect` en cada cambio.
- Borrar un supermercado borra también sus productos (con `confirm`).
- Si se cambia la forma del estado, **subir la versión de la clave** (la siguiente sería `lista-compra-v3`) y migrar los datos antiguos en `loadState`, para no perder la lista del usuario. La v2 (oct. 2026) añadió `photos`: si no hay datos v2 se leen los de `lista-compra-v1` (que se dejan sin tocar).
- `saveState` devuelve `false` si no se pudo guardar (p. ej. sin espacio por las fotos) y `App` lo avisa con un toast.
- Si solo cambia un **valor** guardado (no la forma), se migra en `migrateStores` (`storage.js`) sin subir la clave; debe ser idempotente porque se ejecuta en cada arranque. Ejemplo actual: un súper Carrefour (por id `carrefour` o por nombre) que siga con el rojo antiguo exacto `#c8102e` pasa a `#004e9f`; si tiene otro color, o es otro súper con ese rojo, no se toca.

## Navegación
No hay router. `currentStoreId` decide la pantalla (`null` = inicio). Abrir un súper hace `history.pushState({ store: id })` y el listener de `popstate` toma la pantalla de `e.state` (así funcionan atrás y adelante en el navegador).

**Botón atrás de Android**: el núcleo de Capacitor 7 no lo gestiona (sin plugin, atrás cierra la app siempre). Por eso se usa `@capacitor/app`: en `App` hay un listener de `backButton` que hace `history.back()` si `canGoBack` (→ `popstate` → inicio) y `App.exitApp()` si no (en el inicio, cierra la app). Ojo: si se quita ese listener, el plugin por defecto va atrás en el historial pero **en el inicio no hace nada**. Si se añaden más pantallas, que cada una haga `pushState` para que este esquema siga funcionando.

Lo que se abre **encima** de una pantalla (hojas inferiores, pantalla de escucha) no usa el historial: se apunta con `useBackHandler(abierto, cerrar)` en la pila `backHandlers`, y el listener de `backButton` ejecuta primero el último de la pila. Así atrás cierra la hoja o cancela la escucha sin cambiar de pantalla, y no hay carreras entre `history.back()` y `pushState`. En el navegador, Escape cierra las hojas; atrás del navegador cambia de pantalla (y cancela la escucha en `popstate`).

## Barra de estado (Android)
Configurada en `capacitor.config.json` → `plugins.StatusBar`: `style: "DARK"` (hora e iconos **en blanco**) y `overlaysWebView: true` (la página se dibuja detrás de la barra; las cabeceras usan `env(safe-area-inset-top)` en su `padding-top`).
- La cabecera del inicio (oct. 2026) **no tiene color**: va sobre el fondo de la página. Por eso `App` llama a `StatusBar.setStyle`: `Style.Default` en el inicio (el plugin elige según el tema del sistema: iconos oscuros en claro, blancos en oscuro, y lo reaplica si cambia el tema) y `Style.Dark` en un súper o con la pantalla de escucha abierta (fondos de color). Solo en nativo (`Capacitor.isNativePlatform()`).
- La cabecera del inicio no es fija (`sticky`): `.status-scrim` es una franja fija del color del fondo detrás de la barra de estado, para que la lista no se vea pasar por debajo de la hora.

## Dictado por voz
- **Motor en Android**: plugin nativo propio `VoicePlugin.java` (`registerPlugin('Voice')` en `voice.js`; se registra en `MainActivity` antes de `super.onCreate`). Usa el `SpeechRecognizer` del sistema (normalmente el de Google; el WebView no trae la Web Speech API), idioma `es-ES`, 5 alternativas, sin diálogo de Google (la interfaz es la pantalla de escucha propia). Métodos: `available()`, `listen({ language })` → `{ matches }` o rechazo con `code` `permission`/`nomatch`/`network`/`failed` (pide el permiso `RECORD_AUDIO` si hace falta), `stop()`. Mientras escucha emite los eventos `partial` `{ text }` (resultados parciales, `EXTRA_PARTIAL_RESULTS`) y `level` `{ level }` (rmsdB, como mucho cada 80 ms); `voice.js` se suscribe solo durante la escucha y los traduce a `onPartial(texto)` y `onLevel(0..1)`. El manifiesto declara `RECORD_AUDIO` y la `<queries>` de `RecognitionService` (necesaria en Android 11+).
- **No usar `@capacitor-community/speech-recognition`** (se probó en oct. 2026): destruye y crea un `SpeechRecognizer` en cada escucha y en Android 12+ todas menos la primera fallan al instante («Service is unbinding»). Por eso el plugin propio reutiliza un único reconocedor (solo lo recrea si el servicio se desconecta, `ERROR_SERVER_DISCONNECTED`).
- En el navegador (`npm run dev`) se usa `SpeechRecognition`/`webkitSpeechRecognition` si existe, con `interimResults` para el texto parcial (sin volumen). Si no hay motor, no se muestra el botón de voz. `voice.js` traduce los códigos de error a avisos en español (el `message` del error ya es el texto del toast).
- **Interpretación** (`parseVoice.js`): busca el nombre de un súper en la frase (sin tildes ni mayúsculas, pegando palabras: «Ahorra Más» = «Ahorramas»; si hay varios, gana el último), lo quita junto con «en / el / del / para…» delante, quita órdenes al principio («apunta», «hace falta», «necesito»…) y «por favor» al final, y saca la cantidad del principio («2», «2 kilos de», «medio kilo de», «una docena de»; «un/una» sin unidad es artículo). De las alternativas se queda con la primera que nombre un súper. No separa varios productos: «leche y huevos» se apunta como uno.
- **Interfaz**: botón grande fijo abajo en el centro (`VoiceButton`: «Dime qué necesitas» en el inicio, «Dime qué falta» en un súper, con el color del súper); se oculta mientras hay un campo con el foco (CSS `body:has(input:focus)`), porque ahí va el teclado. Al pulsarlo se abre la pantalla de escucha a pantalla completa (`VoiceOverlay`, con el color del súper): ejemplos que van rotando con los súper del usuario hasta que llega texto, luego lo entendido en grande; el micro central late y su halo crece con el volumen (variable CSS `--level`, que se pone directamente en el elemento sin pasar por el estado de React para no repintar la app ~12 veces por segundo). La escucha vive en `App` (`startVoice(onMatches)`); cada pantalla pasa qué hacer con las alternativas.
- **Comportamiento**: en el inicio, si se dice el súper se apunta directamente; si no, deja el texto en el campo para elegir el súper. En un súper se apunta en ese, salvo que se nombre otro. Todo añadido por voz muestra un toast con el logo del súper y **Deshacer**. Tocar el micro central termina antes (sin aviso si no se dijo nada); la X, el botón atrás o cambiar de pantalla cancelan y descartan el resultado.
- Para probarlo en la vista previa sin micrófono, se puede sustituir `webkitSpeechRecognition.prototype.start`/`stop` por unos que guarden la instancia y llamar a mano a su `onresult` (con `isFinal` false para el texto parcial) y `onend`.
- Probado (oct. 2026): interpretación de frases y flujo completo en el navegador simulando el reconocedor (parciales, final, terminar, cancelar, resultado tardío tras cancelar); en el emulador (API 37), permiso (denegar y conceder), escucha repetida, parar a mano, aviso sin voz, llegada de los eventos `level` y atrás con la escucha abierta. **Falta probar el reconocimiento de una frase real en un móvil** (y ver los parciales y el halo con voz de verdad): el emulador se arrancó sin `-allow-host-audio` (micrófono en silencio).

## Fotos de productos
- Cada producto de la lista de un súper lleva a la izquierda su foto (o un hueco con una cámara). Tocarlo abre `PhotoSheet`: la foto actual en grande y «Quitar foto», «Hacer foto» (`<input type="file" capture="environment">`), «Galería» (`<input type="file">`) y una cuadrícula «De internet».
- **La foto va por nombre** (`state.photos[norm(nombre)]`, `norm` de `parseVoice.js`), no por producto: un producto habitual sale con su foto cada vez que se vuelve a apuntar, en cualquier súper y aunque se haya borrado.
- **Búsqueda** (`photos.js`, solo al abrir la hoja): Wikipedia en español (fotos genéricas: fruta, pan…; se quedan solo artículos cuyo título empieza como el producto y sin paréntesis, como mucho 4) y Open Food Facts (`search.openfoodfacts.org`, productos de España con foto: Hacendado, Dia…, 12). Open Food Facts no manda cabeceras CORS: en Android se pide con `CapacitorHttp` (nativo, va en `@capacitor/core`) y en `npm run dev` por el proxy `/off` de `vite.config.js`. Si las dos fallan, la hoja dice «Sin conexión». Se manda el nombre del producto a esos servicios (nada más).
- **Se guarda una miniatura** JPEG (lado mayor 240 px, calidad 0,75; ~10–40 KB) en data URL, para verla sin conexión en el súper. Si una foto de internet no se deja copiar al canvas (CORS), se guarda su URL. localStorage tiene un límite de unos MB: con cientos de fotos podría llenarse (se avisa).
- **Cámara en Android**: Capacitor (`BridgeWebChromeClient`) abre la cámara con `ACTION_IMAGE_CAPTURE` solo si la ve; en Android 11+ eso exige la `<queries>` de `android.media.action.IMAGE_CAPTURE` en el manifiesto (sin ella abre la galería). No hace falta el permiso `CAMERA` (no está declarado; si se declarase, Capacitor lo pediría).
- El botón de la foto está **dentro** del `<label>` del producto: al ser contenido interactivo, tocarlo no marca la casilla.

## Funcionalidad actual
- Inicio: cabecera sobre el fondo (sin barra de color): fila pequeña con el icono y «ToBuy» y la fecha, y en grande «N cosas por comprar» (número en verde) con los súper donde hay algo pendiente debajo, o «Nada pendiente»; añadido rápido (nombre + cantidad; al escribir aparecen los chips de súper con su logo y el botón «Añadir a X», que toma el color del súper elegido, y el foco vuelve al campo para seguir añadiendo); tarjetas de supermercados en dos columnas (logo sobre blanco arriba y, sobre el color del súper, pendientes, productos y barra de progreso); «Añadir súper» abre una hoja con el nombre (vista previa del símbolo) y las marcas conocidas que aún no están.
- Supermercado: cabecera con el color del súper y su logo en una placa blanca, barra de progreso («X de Y en el carro»), añadir producto, marcar/desmarcar (casilla redonda propia; sección «En el carro»), foto de cada producto (ver «Fotos de productos»), mover a otro súper (hoja con los demás súper y sus logos), borrar producto, quitar los comprados, borrar supermercado.
- Avisos (toast) abajo, gestionados en `App`, con el logo del súper cuando viene al caso: al añadir desde el inicio o por voz (con **Deshacer**), al mover y al borrar. Borrar un producto y «Quitar de la lista» ofrecen **Deshacer** (~4,5 s): los productos vuelven ordenados por `createdAt`.
- Voz: botón grande abajo y pantalla de escucha. Ver «Dictado por voz».
- Hojas inferiores (`Sheet`): se cierran tocando fuera, con la X, con Escape o con atrás. Su fondo se oscurece animando el color, no la opacidad (si no, la hoja dejaría ver el botón de voz mientras sube). `.screen` solo anima la opacidad al entrar: un `transform` haría que los elementos fijos de dentro se colocaran respecto a la pantalla y no a la ventana.
- Sin selección de texto fuera de los campos (`user-select: none` en `body`), para que una pulsación larga no seleccione nada.
- Iconos: SVG en línea (`Icon` + `ICONS` en `App.jsx`), sin dependencias. El color del súper llega al CSS con la variable `--c`; los tonos derivados usan `color-mix()` (WebView ≥ 111).

## Comandos
```bash
npm install
npm run dev                       # probar en el navegador
npm run build                     # genera dist/
npx cap sync android              # tras cada build (copia dist/ y plugins a android/)
npx cap open android              # abre Android Studio
npm run android                   # build + sync + abrir
```
Compilar el APK desde terminal (sin Android Studio): `cd android && ./gradlew assembleDebug` → `android/app/build/outputs/apk/debug/app-debug.apk`. Necesita JDK 21 y el SDK de Android: si no existe `android/local.properties` (no se versiona; lo crea Android Studio), definir `ANDROID_HOME` (en este equipo: `%LOCALAPPDATA%\Android\Sdk`).

## Estado / pendiente
- Verificado (oct. 2026): `npm install` y `npm run build` sin errores; probado en navegador a 380 px (añadido rápido, pantalla de súper, mover/borrar/vaciar, borrar súper, persistencia, modo claro/oscuro); `./gradlew assembleDebug` compila; probado en emulador Android (API 37): carga, safe areas y botón atrás (súper → inicio → cierra la app), barra de estado blanca en inicio y súper con el sistema en claro y en oscuro. Migración de Carrefour probada en navegador (datos antiguos, color personalizado, súper añadido a mano, instalación nueva). Rediseño con logos (oct. 2026) probado en navegador a 390 px en claro y oscuro (tarjetas, chips, hojas de mover y de nuevo súper, sugerencias, súper sin logo, voz simulada) y en el emulador: tarjetas y cabecera con logo, pantalla de escucha, hoja con el teclado abierto (el WebView se redimensiona y la hoja sube por encima del teclado) y atrás con hoja/escucha abiertas, en un súper y en el inicio.
- Cabecera nueva del inicio y fotos (oct. 2026): probado en navegador a 390 px en claro y oscuro (búsqueda con resultados de las dos fuentes, elegir foto, galería con un fichero simulado, quitar foto, foto que reaparece al volver a apuntar el producto, migración de v1 a v2) y en el emulador (API 37): barra de estado oscura en el inicio claro y blanca en el súper, resultados de Open Food Facts vía `CapacitorHttp`, la foto elegida se ve sin conexión tras reiniciar la app, aviso «Sin conexión» en la hoja, y «Hacer foto» con la cámara del emulador. Sin probar: el inicio en modo oscuro en el móvil (barra de estado con `Style.Default`) y fotos de cámara reales (tamaño grande).
- **Sin probar en Android ≤14** (solo hay imagen de API 37). Allí la cabecera detrás de la barra depende de que el WebView del sistema esté actualizado (≥140) para que `env(safe-area-inset-top)` funcione; si el título quedara bajo la barra, esa es la causa.
- Emulador sin ventana: `emulator -avd Medium_Phone_API_37.0 -no-window -no-snapshot-save`. Si hay un móvil conectado por USB, usar siempre `adb -s emulator-5554` para no instalar nada en él por error.
- Ideas posibles (no pedidas aún): reordenar productos, sugerencias de productos ya usados, editar nombre/color de un súper, `@capacitor/preferences` en lugar de localStorage, splash propio para Android ≤ 11, compartir la lista.

## Convenciones
- **Interfaz y textos en español.** Comentarios en español.
- Mantenerlo simple: sin dependencias nuevas salvo que aporten algo claro.
- Diseño mobile-first; probar a ~380 px de ancho; respetar `env(safe-area-inset-*)`.
- Commits pequeños con mensajes en español.

## Git / GitHub
- Rama `main`, repo público en GitHub: https://github.com/aropero8/tobuy (`origin`).
- Los commits usan el email noreply de GitHub (`user.email` configurado **solo en este repo**): la cuenta bloquea los push que exponen el email personal. No cambiarlo.
- `.gitattributes` fuerza LF en `android/gradlew` (y está marcado como ejecutable, `100755`).
- Ubicación local: `C:\Users\ALBERTO\Desktop\repos\carrito` (Windows).
- `.gitignore` excluye `node_modules`, `dist`, `.env*`, `.claude/settings.local.json` (ajustes personales; `.claude/launch.json` sí se sube) y los ficheros de firma de Android (`*.jks`, `*.keystore`, `keystore.properties`). **Nunca subir keystores ni secretos.**
- `android/` sí se versiona (Capacitor genera su propio `android/.gitignore`).
- Licencia GPL-3.0-or-later: texto oficial en `LICENSE`, campo `license` en `package.json` y aviso al final del `README.md`. Al ser público, se ve **todo el historial**: antes de cada push, comprobar que no entra nada sensible (keystores, `.env`, emails personales, contraseñas).

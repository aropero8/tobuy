# 🛒 ToBuy


Lista de la compra organizada por supermercado.
App en React (Vite) preparada para empaquetar en Android con Capacitor.

## Qué hace
- **Inicio**: cada supermercado con su logo y lo que tienes pendiente en él; añade productos rápido eligiendo el súper con un toque.
- **Pantalla de supermercado**: tu lista para esa tienda; marca lo que metes en el carro, mueve productos a otro súper, bórralos o quita lo ya comprado (con opción de deshacer).
- **Fotos de productos**: toca el hueco de la foto de un producto y elige una de internet (Wikipedia y Open Food Facts), hazla con la cámara o cógela de la galería. La foto se recuerda por nombre: la próxima vez que apuntes ese producto, sale con ella. Se guarda en el móvil, así que se ve sin conexión.
- **Por voz**: pulsa el micro de abajo y di, por ejemplo, «queso Carrefour» o «2 kilos de naranjas en el Lidl»; ves lo que va entendiendo y se apunta solo.
- Puedes añadir o borrar supermercados; los conocidos (Mercadona, Lidl, Carrefour, Dia, Ahorramás, Aldi, Eroski…) salen con su logo.
- **Lista compartida**: con el botón de las personas del inicio, pásale a alguien el código de tu lista; cuando lo pegue en su móvil, lo que apuntéis cualquiera de los dos aparece en los dos al momento. Funciona sin conexión y se sincroniza al volver.
- **También en iPhone**: la versión web, https://aropero8.github.io/tobuy/, se instala desde Safari (Compartir → Añadir a pantalla de inicio) y funciona como una app.

## Probar en el navegador
```bash
npm install
npm run dev
```

## Lista compartida (Firebase)
La lista se comparte con [Firebase](https://firebase.google.com) (Firestore, plan gratuito), sin cuentas: cada móvil entra de forma anónima.
Para usar tu propio proyecto:
1. En la [consola de Firebase](https://console.firebase.google.com), crea un proyecto.
2. *Authentication* → *Sign-in method* → activa **Anónimo**.
3. *Firestore Database* → crea la base de datos y, en *Reglas*, pega el contenido de `firestore.rules`.
4. *Configuración del proyecto* → *Tus apps* → añade una app **web** y copia su configuración en `src/firebaseConfig.js`.

Sin configuración (`null`), la app funciona igual pero solo en el móvil. Para probar sin proyecto, con los emuladores de Firebase (necesita Java):
```bash
npx firebase-tools emulators:start --only auth,firestore --project demo-tobuy
npm run dev:emulador
```

## Versión web
Se publica sola en GitHub Pages con cada cambio en `main` (`.github/workflows/pages.yml`; en el repo, *Settings → Pages → Source: GitHub Actions*). Funciona sin conexión gracias a un service worker.

## Crear la app Android
Necesitas Android Studio instalado. El proyecto nativo ya está en `android/`.
```bash
npm install
npm run build
npx cap sync android
npx cap open android     # abre Android Studio → botón ▶ para instalarla en el móvil
```
Después de cambiar código: `npm run android` (build + sync + abrir Android Studio).

Para cambiar el identificador o el nombre de la app, edita `capacitor.config.json`.

## Estructura
```
src/
  App.jsx      pantallas (inicio y supermercado) y lógica
  App.css      estilos (modo claro y oscuro)
  brands.js    logos de supermercados conocidos (imágenes en assets/stores/)
  storage.js   guardado local y supermercados por defecto
  sync.js      lista compartida con Firebase
  sw.js        service worker de la versión web
  photos.js    búsqueda de fotos de productos y miniaturas
  voice.js     micrófono: reconocimiento de voz en Android y en el navegador
  parseVoice.js  frase dictada → producto, cantidad y súper
firestore.rules         reglas de seguridad de la lista compartida
public/                 manifiesto e iconos de la versión web
capacitor.config.json   configuración de la app Android
android/                proyecto Android (generado por Capacitor)
  …/VoicePlugin.java    plugin nativo de reconocimiento de voz
```

## Tecnologías
React 18 · Vite · Capacitor 7 · Firebase (Firestore)

## Licencia
Copyright (C) 2026 aropero8.

Este programa es software libre: puedes redistribuirlo y/o modificarlo bajo los términos de la [Licencia Pública General de GNU](LICENSE) (GPL) publicada por la Free Software Foundation, versión 3 o (a tu elección) cualquier versión posterior. Se distribuye SIN NINGUNA GARANTÍA.

Las fotos que se eligen de internet vienen de [Wikipedia](https://es.wikipedia.org) y [Open Food Facts](https://world.openfoodfacts.org); para buscarlas se les envía el nombre del producto. La lista (productos, supermercados y miniaturas de las fotos) se guarda en tu móvil y, con la lista compartida, en Firebase (Google), donde solo pueden leerla los móviles que se han unido con su código.

Los logotipos de `src/assets/stores/` son marcas de sus respectivos propietarios. Se incluyen solo para identificar cada supermercado en la lista, no están cubiertos por la licencia GPL y este proyecto no tiene relación con esas empresas.

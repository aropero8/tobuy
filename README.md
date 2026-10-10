# 🛒 ToBuy


Lista de la compra organizada por supermercado.
App en React (Vite) preparada para empaquetar en Android con Capacitor.

## Qué hace
- **Inicio**: cada supermercado con su logo y lo que tienes pendiente en él; añade productos rápido eligiendo el súper con un toque.
- **Pantalla de supermercado**: tu lista para esa tienda; marca lo que metes en el carro, mueve productos a otro súper, bórralos o quita lo ya comprado (con opción de deshacer).
- **Fotos de productos**: toca el hueco de la foto de un producto y elige una de internet (Wikipedia y Open Food Facts), hazla con la cámara o cógela de la galería. La foto se recuerda por nombre: la próxima vez que apuntes ese producto, sale con ella. Se guarda en el móvil, así que se ve sin conexión.
- **Por voz**: pulsa «Dime qué necesitas» y di, por ejemplo, «queso Carrefour» o «2 kilos de naranjas en el Lidl»; ves lo que va entendiendo y se apunta solo.
- Puedes añadir o borrar supermercados; los conocidos (Mercadona, Lidl, Carrefour, Dia, Aldi, Eroski…) salen con su logo. Todo se guarda en el móvil.

## Probar en el navegador
```bash
npm install
npm run dev
```

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
  photos.js    búsqueda de fotos de productos y miniaturas
  voice.js     micrófono: reconocimiento de voz en Android y en el navegador
  parseVoice.js  frase dictada → producto, cantidad y súper
capacitor.config.json   configuración de la app Android
android/                proyecto Android (generado por Capacitor)
  …/VoicePlugin.java    plugin nativo de reconocimiento de voz
```

## Tecnologías
React 18 · Vite · Capacitor 7

## Licencia
Copyright (C) 2026 aropero8.

Este programa es software libre: puedes redistribuirlo y/o modificarlo bajo los términos de la [Licencia Pública General de GNU](LICENSE) (GPL) publicada por la Free Software Foundation, versión 3 o (a tu elección) cualquier versión posterior. Se distribuye SIN NINGUNA GARANTÍA.

Las fotos que se eligen de internet vienen de [Wikipedia](https://es.wikipedia.org) y [Open Food Facts](https://world.openfoodfacts.org) y solo se guardan en tu móvil; para buscarlas se les envía el nombre del producto.

Los logotipos de `src/assets/stores/` son marcas de sus respectivos propietarios. Se incluyen solo para identificar cada supermercado en la lista, no están cubiertos por la licencia GPL y este proyecto no tiene relación con esas empresas.

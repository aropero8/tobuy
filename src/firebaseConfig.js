// Configuración del proyecto de Firebase (consola de Firebase → Configuración del proyecto → Tus apps → Web).
// No es secreta: va dentro de la app y cualquiera puede verla. Lo que protege la lista son las reglas de
// firestore.rules (solo los móviles que se han unido a una lista pueden leerla o cambiarla).
// Con `null` la app funciona como antes: solo en el móvil, sin lista compartida.
export default {
  apiKey: 'AIzaSyBtoPkoqKJisVJN8JfUsOn6YYvnYmZ0yc0',
  authDomain: 'tobuy-compra.firebaseapp.com',
  projectId: 'tobuy-compra',
  appId: '1:57208178532:web:52b124ea37f060e5f8dc71',
  messagingSenderId: '57208178532',
};

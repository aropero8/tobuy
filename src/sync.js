// Lista compartida: Firestore (la base de datos de Firebase) con acceso anónimo.
//
// Cada lista es un documento lists/{id} con los móviles que la ven (`members`: uids anónimos) y tres
// subcolecciones: stores (súper, con su orden), items (productos) y photos (miniaturas por nombre).
// El id de la lista es también el código para unirse: es aleatorio y largo, y las reglas (firestore.rules)
// solo dejan que quien lo sepa se añada a sí mismo.
//
// La app sigue trabajando con el mismo estado { stores, items, photos }: cada cambio se compara con el
// anterior (diffState) y se envían solo los documentos que cambian, y lo que llega de la nube (de este
// móvil o del otro) sustituye a esa parte del estado. Firestore guarda una copia en el móvil, así que la
// lista se puede usar sin conexión: lo pendiente se envía al volver.
import { useCallback, useEffect, useRef, useState } from 'react';
import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence, connectAuthEmulator, indexedDBLocalPersistence, initializeAuth, signInAnonymously,
} from 'firebase/auth';
import {
  arrayUnion, collection, connectFirestoreEmulator, doc, initializeFirestore, onSnapshot, persistentLocalCache,
  persistentMultipleTabManager, serverTimestamp, updateDoc, writeBatch,
} from 'firebase/firestore';
import firebaseConfig from './firebaseConfig.js';

// `npm run dev:emulador`: contra los emuladores locales de Firebase (proyecto de prueba, sin cuenta)
const EMULATOR = import.meta.env.DEV && import.meta.env.MODE === 'emulador';
const config = EMULATOR ? { apiKey: 'demo', projectId: 'demo-tobuy' } : firebaseConfig;
export const syncAvailable = !!config;

const LIST_KEY = 'tobuy-lista'; // id de la lista que ve este móvil
// Operaciones por envío: las reglas consultan la lista en cada una y hay un límite de consultas por envío
const BATCH = 10;

/* ---------------- Estado ↔ documentos ---------------- */
const EMPTY = { stores: [], items: [], photos: {} };
const STORE_FIELDS = ['name', 'color', 'order'];
const ITEM_FIELDS = ['name', 'qty', 'storeId', 'done', 'createdAt'];
const photoDoc = (key) => 'p' + key; // el prefijo evita un id vacío (un nombre sin letras ni números)
const withOrder = (stores) => stores.map((s, order) => ({ ...s, order }));
const photoDocs = (photos) => Object.entries(photos).map(([key, data]) => ({ id: photoDoc(key), data }));

// Documentos nuevos (enteros), cambiados (solo los campos que cambian, para no pisar lo que cambie el otro
// móvil a la vez) y borrados
function diffDocs(col, prev, next, fields, ops) {
  const before = new Map(prev.map((d) => [d.id, d]));
  for (const d of next) {
    const old = before.get(d.id);
    before.delete(d.id);
    const data = {};
    for (const f of fields) if (!old || old[f] !== d[f]) data[f] = d[f];
    if (Object.keys(data).length) ops.push({ col, id: d.id, data, merge: !!old });
  }
  for (const id of before.keys()) ops.push({ col, id, del: true });
}

export function diffState(prev, next) {
  const ops = [];
  if (prev.stores !== next.stores) diffDocs('stores', withOrder(prev.stores), withOrder(next.stores), STORE_FIELDS, ops);
  if (prev.items !== next.items) diffDocs('items', prev.items, next.items, ITEM_FIELDS, ops);
  if (prev.photos !== next.photos) diffDocs('photos', photoDocs(prev.photos), photoDocs(next.photos), ['data'], ops);
  return ops;
}

const docs = (snap) => snap.docs.map((d) => ({ ...d.data(), id: d.id }));
const PARSE = {
  stores: (snap) => ({
    stores: docs(snap)
      .filter((s) => typeof s.name === 'string')
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : 1))
      .map(({ id, name, color }) => ({ id, name, color: color ?? '#5a5a5a' })),
  }),
  items: (snap) => ({
    items: docs(snap)
      // Un producto borrado en un móvil mientras se cambiaba en el otro puede quedar a medias: se ignora
      .filter((i) => typeof i.name === 'string' && i.storeId)
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || (a.id < b.id ? -1 : 1))
      .map(({ id, name, qty, storeId, done, createdAt }) => ({
        id, name, qty: qty ?? '', storeId, done: !!done, createdAt: createdAt ?? 0,
      })),
  }),
  photos: (snap) => ({
    photos: Object.fromEntries(
      snap.docs.filter((d) => typeof d.get('data') === 'string').map((d) => [d.id.slice(1), d.get('data')])
    ),
  }),
};

/* ---------------- Conexión ---------------- */
let fb = null;
function firebase() {
  if (!fb) {
    const app = initializeApp(config);
    // Sin el código de ventanas emergentes de Google: aquí solo hace falta el acceso anónimo
    const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
    const db = initializeFirestore(app, {
      ignoreUndefinedProperties: true,
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
    if (EMULATOR) {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      connectFirestoreEmulator(db, '127.0.0.1', 8080);
    }
    fb = { auth, db };
  }
  return fb;
}

let client = null; // lo que pasa useSyncedState: { onRemote, onInfo, onError }
let latest = EMPTY; // último estado de la app
let started = false;
let ready = false; // ya hay usuario y lista: los cambios se envían al momento
let queue = []; // cambios de antes de estar listo
let listId = null;
let unsubs = [];
let failures = 0;
// status: off (sin Firebase) · connecting · ok · offline · error
let info = { status: syncAvailable ? 'connecting' : 'off', listId: null, members: 0 };

const setInfo = (patch) => {
  info = { ...info, ...patch };
  client?.onInfo(info);
};
const fail = (e) => {
  console.warn('[sync]', e);
  client?.onError('No se ha podido guardar en la nube');
};

function send(ops) {
  if (!ops.length) return;
  const { db } = firebase();
  for (let i = 0; i < ops.length; i += BATCH) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + BATCH)) {
      const ref = doc(db, 'lists', listId, op.col, op.id);
      if (op.del) batch.delete(ref);
      else batch.set(ref, op.data, { merge: op.merge });
    }
    // Sin conexión no se resuelve hasta que vuelva (ya está guardado en el móvil): no se espera
    batch.commit().catch(fail);
  }
}

function push(prev, next) {
  const ops = diffState(prev, next);
  if (ready) send(ops);
  else queue.push(...ops);
}

// Lista nueva con lo que ya hubiera en el móvil
function createList() {
  const { auth, db } = firebase();
  const ref = doc(collection(db, 'lists'));
  listId = ref.id;
  localStorage.setItem(LIST_KEY, listId);
  const batch = writeBatch(db);
  batch.set(ref, { members: [auth.currentUser.uid], createdAt: serverTimestamp() });
  batch.commit().catch(fail);
  send(diffState(EMPTY, latest));
}

const waitOnline = () =>
  new Promise((resolve) => {
    const done = () => {
      window.removeEventListener('online', done);
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(done, 15000);
    window.addEventListener('online', done);
  });

async function start() {
  if (started) return;
  started = true;
  const { auth } = firebase();
  await auth.authStateReady();
  // La primera vez hace falta conexión para conseguir el usuario anónimo; mientras, la lista sigue en el móvil
  while (!auth.currentUser) {
    try {
      await signInAnonymously(auth);
    } catch (e) {
      console.warn('[sync]', e);
      setInfo({ status: 'offline' });
      await waitOnline();
    }
  }
  listId = localStorage.getItem(LIST_KEY);
  if (listId) send(queue);
  else createList(); // ya incluye lo que hubiera en la cola
  queue = [];
  ready = true;
  subscribe(listId);
}

function unsubscribe() {
  unsubs.forEach((u) => u());
  unsubs = [];
}

function subscribe(id) {
  unsubscribe();
  listId = id;
  setInfo({ listId: id, status: 'connecting' });
  const { db } = firebase();
  const seen = new Set();
  let retrying = false;

  // Si falla (p. ej. la lista recién creada aún no ha llegado al servidor y las reglas no la encuentran),
  // se vuelve a intentar cada vez más tarde
  const onError = (e) => {
    console.warn('[sync]', e);
    if (retrying || listId !== id) return;
    retrying = true;
    unsubscribe();
    failures++;
    if (failures >= 3) setInfo({ status: 'error' });
    setTimeout(() => listId === id && subscribe(id), Math.min(30000, 1000 * 2 ** failures));
  };

  const opts = { includeMetadataChanges: true };
  for (const col of Object.keys(PARSE)) {
    unsubs.push(
      onSnapshot(collection(db, 'lists', id, col), opts, (snap) => {
        if (col === 'items') {
          setInfo({ status: snap.metadata.fromCache ? 'offline' : 'ok' });
          if (!snap.metadata.fromCache) failures = 0;
        }
        // Al arrancar, una copia local vacía (recién instalada o recién unida) no borra lo que se ve: se
        // espera a lo que diga el servidor
        if (!seen.has(col) && snap.empty && snap.metadata.fromCache) return;
        if (seen.has(col) && !snap.docChanges().length) return; // solo cambió si está enviado o no
        seen.add(col);
        latest = { ...latest, ...PARSE[col](snap) };
        client?.onRemote(latest);
      }, onError)
    );
  }
  unsubs.push(
    onSnapshot(doc(db, 'lists', id), (snap) => setInfo({ members: snap.get('members')?.length ?? 0 }), onError)
  );
}

// Unirse a la lista de otro con su código. Hace falta conexión: el servidor comprueba que existe.
export async function joinList(rawCode) {
  const code = rawCode.trim();
  if (!/^[A-Za-z0-9]{20}$/.test(code)) throw new Error('Ese código no es válido');
  if (code === listId) throw new Error('Ya estás en esa lista');
  if (!ready) throw new Error('Aún no está conectado: prueba en un momento');
  if (!navigator.onLine) throw new Error('Hace falta conexión para unirse');
  const { auth, db } = firebase();
  try {
    await Promise.race([
      updateDoc(doc(db, 'lists', code), { members: arrayUnion(auth.currentUser.uid) }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000)),
    ]);
  } catch (e) {
    console.warn('[sync]', e);
    throw new Error(
      e.code === 'permission-denied' || e.code === 'not-found'
        ? 'No hay ninguna lista con ese código'
        : 'No se ha podido conectar. Prueba otra vez'
    );
  }
  localStorage.setItem(LIST_KEY, code);
  failures = 0;
  subscribe(code);
}

/* ---------------- Hook para App ---------------- */
// Como useState, pero los cambios se envían a la lista compartida y los de la nube llegan solos.
// Devuelve además el estado de la conexión: { status, listId, members }.
export function useSyncedState(load, onError) {
  const [state, setState] = useState(() => (latest = load()));
  const ref = useRef(state);
  const [syncInfo, setSyncInfo] = useState(info);
  const errorRef = useRef(onError);
  errorRef.current = onError;

  useEffect(() => {
    if (!syncAvailable) return;
    client = {
      onRemote: (s) => {
        ref.current = s;
        setState(s);
      },
      onInfo: setSyncInfo,
      onError: (msg) => errorRef.current?.(msg),
    };
    setSyncInfo(info);
    start().catch((e) => {
      console.warn('[sync]', e);
      setInfo({ status: 'error' });
    });
    return () => {
      client = null;
    };
  }, []);

  const update = useCallback((fn) => {
    const prev = ref.current;
    const next = typeof fn === 'function' ? fn(prev) : fn;
    if (next === prev) return;
    ref.current = latest = next;
    setState(next);
    if (syncAvailable) push(prev, next);
  }, []);

  return [state, update, syncInfo];
}

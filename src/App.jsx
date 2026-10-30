import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { loadState, saveState, uid } from './storage.js';
import { joinList, useSyncedState } from './sync.js';
import { norm, parseVoice } from './parseVoice.js';
import { makeThumb, offAvailable, searchPhotos } from './photos.js';
import { listen, stopListening, voiceAvailable } from './voice.js';
import { BRANDS, brandOf } from './brands.js';

const COLORS = ['#1f7a4d', '#0050aa', '#c8102e', '#e4002b', '#f39200', '#6b3fa0', '#008c95', '#5a5a5a'];

// Color de un súper nuevo: el de su marca si es conocida; si no, el siguiente de la paleta
const colorFor = (name, stores) => brandOf(name)?.color ?? COLORS[stores.length % COLORS.length];

// «Cualquier súper»: lo que da igual dónde comprar. No es un súper del estado (no se puede borrar ni renombrar):
// sus productos llevan storeId ANY y salen también en la lista de cada súper. `aliases` es para la voz.
const ANY = 'any';
const ANY_STORE = {
  id: ANY, name: 'Cualquier súper', color: '#6b3fa0',
  aliases: ['cualquier supermercado', 'cualquier sitio', 'cualquier lado', 'cualquier parte', 'cualquiera',
    'donde sea', 'da igual donde'],
};
// Nombre para ponerlo a media frase («añadido a cualquier súper», «añadido a Lidl»)
const inName = (store) => (store.id === ANY ? 'cualquier súper' : store.name);

// Botón atrás de Android: lo abierto encima (una hoja, la escucha) se cierra antes de cambiar de pantalla.
// Cada uno apunta aquí su acción mientras está abierto; se ejecuta la del último.
const backHandlers = [];
function useBackHandler(active, onBack) {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => {
    if (!active) return;
    const fn = () => ref.current();
    backHandlers.push(fn);
    return () => {
      const i = backHandlers.indexOf(fn);
      if (i >= 0) backHandlers.splice(i, 1);
    };
  }, [active]);
}

export default function App() {
  // Con Firebase configurado, la lista se comparte (sync.js); el estado se sigue guardando aquí como copia
  // para arrancar al instante
  const [state, setState, sync] = useSyncedState(loadState, (msg) => showToast(msg));
  const [currentStoreId, setCurrentStoreId] = useState(null);
  const [toast, setToast] = useState(null); // { id, text, store?, undo? }
  const toastTimer = useRef(null);
  const [voiceOk, setVoiceOk] = useState(false);
  const [listening, setListening] = useState(null); // mientras escucha: { text } (lo entendido hasta ahora)
  const session = useRef(null); // escucha en curso: { stopped, gone }
  const overlayRef = useRef(null);

  // Si no cabe (las fotos ocupan), se avisa: lo último no quedaría guardado
  useEffect(() => {
    if (!saveState(state)) showToast('No queda espacio en el móvil: quita alguna foto');
  }, [state]);

  useEffect(() => {
    let alive = true;
    voiceAvailable().then((ok) => alive && setVoiceOk(ok));
    return () => {
      alive = false;
    };
  }, []);

  // Navegación con el historial: la pantalla sale de history.state (atrás/adelante del navegador).
  // Si se cambia de pantalla mientras escucha, se descarta lo que llegue.
  useEffect(() => {
    const onPop = (e) => {
      if (session.current) {
        session.current.gone = true;
        stopListening();
        setListening(null);
      }
      setCurrentStoreId(e.state?.store ?? null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Botón "atrás" de Android: Capacitor no lo gestiona por sí solo (sin esto cerraría la app).
  // Primero cierra lo que haya abierto encima; si no, vuelve atrás (→ popstate → inicio) o, en el inicio, cierra la app.
  useEffect(() => {
    const handle = CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      if (backHandlers.length) backHandlers[backHandlers.length - 1]();
      else if (canGoBack) window.history.back();
      else CapacitorApp.exitApp();
    });
    return () => {
      handle.then((h) => h.remove());
    };
  }, []);

  // Aviso temporal en la parte de abajo, con el logo del súper y «Deshacer» opcionales
  const showToast = (text, { store, undo } = {}) => {
    clearTimeout(toastTimer.current);
    setToast({ id: uid(), text, store, undo });
    toastTimer.current = setTimeout(() => setToast(null), undo ? 4500 : 2500);
  };
  const hideToast = () => {
    clearTimeout(toastTimer.current);
    setToast(null);
  };

  const openStore = (id) => {
    window.history.pushState({ store: id }, '');
    setCurrentStoreId(id);
    hideToast();
  };
  const goHome = () => {
    if (window.history.state?.store) window.history.back();
    else setCurrentStoreId(null);
  };

  // ---- voz ----
  // La escucha vive aquí (no en cada pantalla) para enseñarla a pantalla completa por encima de todo.
  // onMatches recibe las alternativas reconocidas; cada pantalla decide qué hacer con ellas.
  const startVoice = async (onMatches) => {
    if (session.current) return;
    hideToast();
    const s = (session.current = {});
    setListening({ text: '' });
    try {
      const matches = await listen({
        onPartial: (text) => !s.gone && setListening((l) => l && { text }),
        // El volumen llega muchas veces por segundo: va directo al CSS, sin volver a pintar la app
        onLevel: (level) => overlayRef.current?.style.setProperty('--level', level),
      });
      if (!s.gone) onMatches(matches);
    } catch (e) {
      // Si lo ha parado el usuario sin llegar a decir nada, no hace falta avisar
      if (!s.gone && !s.stopped) showToast(e.message);
    } finally {
      session.current = null;
      if (!s.gone) setListening(null);
    }
  };
  // Terminar ya: lo dicho hasta ahora se reconoce igualmente
  const finishVoice = () => {
    if (!session.current) return;
    session.current.stopped = true;
    stopListening();
  };
  // Cancelar: se cierra y se descarta lo que llegue
  const cancelVoice = () => {
    if (session.current) {
      session.current.gone = true;
      stopListening();
    }
    setListening(null);
  };
  useBackHandler(!!listening, cancelVoice);

  // ---- acciones ----
  const addItem = (name, storeId, qty = '') => {
    const id = uid();
    setState((s) => ({
      ...s,
      items: [...s.items, { id, name: name.trim(), qty: qty.trim(), storeId, done: false, createdAt: Date.now() }],
    }));
    return id;
  };
  const undoAdd = (id) => () => setState((s) => ({ ...s, items: s.items.filter((i) => i.id !== id) }));

  // Desde el inicio y por voz se avisa de dónde se ha apuntado, con deshacer por si se ha entendido mal
  const addItemWithNotice = (name, storeId, qty = '') => {
    const id = addItem(name, storeId, qty);
    const st = allStores.find((s) => s.id === storeId);
    const where = storeId === currentStoreId || !st ? '' : ` a ${inName(st)}`;
    showToast(`«${name.trim()}»${qty.trim() ? ` (${qty.trim()})` : ''} añadido${where}`, { store: st, undo: undoAdd(id) });
  };
  const addVoiceItem = ({ name, qty }, storeId) => addItemWithNotice(name, storeId, qty);

  // Lo de cualquier súper, al marcarlo en un súper, pasa al carro de ese súper (para que no salga comprado
  // en los demás); `fromAny` lo recuerda para devolverlo a cualquier súper si se desmarca. Se pone a false en
  // vez de quitarlo: en la lista compartida, un campo que desaparece no se borra en la nube
  const toggleItem = (id, inStoreId) =>
    setState((s) => ({
      ...s,
      items: s.items.map((i) => {
        if (i.id !== id) return i;
        if (!i.done && i.storeId === ANY && inStoreId !== ANY) return { ...i, done: true, storeId: inStoreId, fromAny: true };
        if (i.done && i.fromAny) return { ...i, done: false, storeId: ANY, fromAny: false };
        return { ...i, done: !i.done };
      }),
    }));

  // Quita productos y ofrece deshacer: se vuelven a meter en su sitio (orden por fecha de creación)
  const removeItems = (removed, text) => {
    if (removed.length === 0) return;
    const ids = new Set(removed.map((i) => i.id));
    setState((s) => ({ ...s, items: s.items.filter((i) => !ids.has(i.id)) }));
    showToast(text, {
      undo: () =>
        setState((s) => {
          const storeIds = new Set([ANY, ...s.stores.map((st) => st.id)]);
          const back = removed.filter((i) => storeIds.has(i.storeId) && !s.items.some((x) => x.id === i.id));
          return { ...s, items: [...s.items, ...back].sort((a, b) => a.createdAt - b.createdAt) };
        }),
    });
  };

  const deleteItem = (id) => {
    const item = state.items.find((i) => i.id === id);
    if (item) removeItems([item], `«${item.name}» borrado`);
  };

  const moveItem = (id, storeId) => {
    // Movido a mano: ya no vuelve solo a cualquier súper
    setState((s) => ({ ...s, items: s.items.map((i) => (i.id === id ? { ...i, storeId, fromAny: false } : i)) }));
    const st = allStores.find((s) => s.id === storeId);
    if (st) showToast(`Movido a ${inName(st)}`, { store: st });
  };

  // Quita los comprados de los que se ven en la pantalla (en un súper, también los de cualquier súper)
  const clearDone = (shown) => {
    const removed = shown.filter((i) => i.done);
    removeItems(removed, removed.length === 1 ? '1 producto quitado' : `${removed.length} productos quitados`);
  };

  const addStore = (name) =>
    setState((s) => ({ ...s, stores: [...s.stores, { id: uid(), name: name.trim(), color: colorFor(name, s.stores) }] }));

  const deleteStore = (id) =>
    setState((s) => ({ ...s, stores: s.stores.filter((st) => st.id !== id), items: s.items.filter((i) => i.storeId !== id) }));

  // Fotos por nombre de producto: así un producto habitual sale con su foto cada vez que se apunta
  const setPhoto = (name, photo) =>
    setState((s) => {
      const photos = { ...s.photos };
      if (photo) photos[norm(name)] = photo;
      else delete photos[norm(name)];
      return { ...s, photos };
    });

  const joinShared = async (code) => {
    await joinList(code);
    showToast('Ya estás en la lista compartida');
  };

  const allStores = [ANY_STORE, ...state.stores];
  const store = allStores.find((s) => s.id === currentStoreId);
  // En un súper se ven sus productos y los de cualquier súper
  const shownItems = store ? state.items.filter((i) => i.storeId === store.id || i.storeId === ANY) : [];

  // Barra de estado: iconos blancos sobre las cabeceras de color (súper, escucha); en el inicio, que tiene
  // el fondo de la página, los del tema del sistema (DEFAULT: oscuros en claro, blancos en oscuro)
  const darkBar = !!store || !!listening;
  useEffect(() => {
    if (Capacitor.isNativePlatform()) StatusBar.setStyle({ style: darkBar ? Style.Dark : Style.Default }).catch(() => {});
  }, [darkBar]);

  // Ejemplos para la pantalla de escucha, con los súper del usuario
  const names = state.stores.map((s) => s.name);
  const voiceExamples = store
    ? ['2 litros de leche', 'una docena de huevos', 'pan de molde']
    : names.length
      ? [`leche en ${names[0]}`, `2 kilos de naranjas en ${names[1 % names.length]}`, 'una docena de huevos']
      : ['leche'];

  return (
    <>
      {store ? (
        <StoreScreen
          key={store.id}
          store={store}
          stores={state.stores}
          items={shownItems}
          photos={state.photos}
          onSetPhoto={setPhoto}
          voiceOk={voiceOk}
          onStartVoice={startVoice}
          onBack={goHome}
          onAdd={(name, qty) => addItem(name, store.id, qty)}
          onVoiceAdd={addVoiceItem}
          onNotice={showToast}
          onToggle={(id) => toggleItem(id, store.id)}
          onDelete={deleteItem}
          onMove={moveItem}
          onClearDone={() => clearDone(shownItems)}
          onDeleteStore={() => {
            if (confirm(`¿Borrar ${store.name} y todos sus productos?`)) {
              deleteStore(store.id);
              goHome();
            }
          }}
        />
      ) : (
        <HomeScreen
          key="home"
          stores={state.stores}
          items={state.items}
          voiceOk={voiceOk}
          onStartVoice={startVoice}
          onOpenStore={openStore}
          onAddItem={addItemWithNotice}
          onVoiceAdd={addVoiceItem}
          onNotice={showToast}
          onAddStore={addStore}
          sync={sync}
          onJoin={joinShared}
        />
      )}
      {listening && (
        <VoiceOverlay
          rootRef={overlayRef}
          text={listening.text}
          store={store}
          examples={voiceExamples}
          onFinish={finishVoice}
          onCancel={cancelVoice}
        />
      )}
      {toast && (
        <div className={'toast' + (voiceOk ? ' above-fab' : '')} key={toast.id} role="status">
          {toast.store && <StoreMark store={toast.store} size={30} />}
          <span className="toast-text">{toast.text}</span>
          {toast.undo && (
            <button
              className="toast-action"
              onClick={() => {
                toast.undo();
                hideToast();
              }}
            >
              Deshacer
            </button>
          )}
        </div>
      )}
    </>
  );
}

/* ---------------- Iconos (SVG en línea, heredan el color del texto) ---------------- */
const Icon = ({ d, size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const ICONS = {
  back: 'M15 18l-6-6 6-6',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
  move: 'M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  chevron: 'M9 6l6 6-6 6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  mic: 'M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM19 11a7 7 0 0 1-14 0M12 18v3',
  camera: 'M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5zM12 16a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z',
  image: 'M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM4 16l4.5-4.5 4 4 2.5-2.5L20 18M16.5 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z',
  cart: 'M3 4h2.2l2.3 10.5a1.5 1.5 0 0 0 1.5 1.2h8.4a1.5 1.5 0 0 0 1.5-1.1L21 8H6.1M10 20a1 1 0 1 0-2 0 1 1 0 0 0 2 0zM18 20a1 1 0 1 0-2 0 1 1 0 0 0 2 0z',
  store: 'M4.5 4h15L21 9a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0zM5 12v8h14v-8M10 20v-5h4v5',
  people: 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 20v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
  share: 'M12 15V3M8 7l4-4 4 4M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6',
};

/* ---------------- Logos de los súper ---------------- */
// Símbolo cuadrado del súper; si no tiene logo, su inicial sobre su color
function StoreMark({ store, size = 28 }) {
  const box = { width: size, height: size };
  if (store.id === ANY)
    return (
      <span className="mark letter" style={{ ...box, '--c': store.color }} aria-hidden="true">
        <Icon d={ICONS.store} size={size * 0.6} />
      </span>
    );
  const brand = brandOf(store.name);
  return brand?.mark ? (
    <span className="mark" style={box}>
      <img src={brand.mark} alt="" />
    </span>
  ) : (
    <span className="mark letter" style={{ ...box, fontSize: size * 0.48, '--c': store.color }} aria-hidden="true">
      {store.name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

// Logotipo completo; si no lo tiene, el nombre en grande con su color
function StoreLogo({ store }) {
  if (store.id === ANY)
    return (
      <span className="logo-any" style={{ '--c': store.color }}>
        <Icon d={ICONS.store} size={26} /> {store.name}
      </span>
    );
  const brand = brandOf(store.name);
  return brand ? (
    <img className="logo" src={brand.logo} alt={store.name} style={{ '--scale': brand.scale }} />
  ) : (
    <span className="logo-text" style={{ '--c': store.color }}>{store.name}</span>
  );
}

/* ---------------- Hoja inferior (mover producto, nuevo súper) ---------------- */
function Sheet({ title, onClose, children }) {
  useBackHandler(true, onClose);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon" aria-label="Cerrar" onClick={onClose}>
            <Icon d={ICONS.close} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------------- Voz ---------------- */
// Botón redondo y fijo abajo para dictar (se oculta mientras se escribe, ver CSS); el texto va como etiqueta accesible
function VoiceButton({ label, onClick }) {
  return (
    <button className="voice-fab" onClick={onClick} aria-label={label} title={label}>
      <Icon d={ICONS.mic} size={30} />
    </button>
  );
}

// Pantalla de escucha: lo que va entendiendo en grande y el micro latiendo (con el volumen, en Android).
// Tocar el micro termina antes; la X (o atrás) cancela.
function VoiceOverlay({ rootRef, text, store, examples, onFinish, onCancel }) {
  const [example, setExample] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setExample((n) => (n + 1) % examples.length), 2600);
    return () => clearInterval(t);
  }, [examples.length]);

  return (
    <div
      ref={rootRef}
      className="voice-overlay"
      style={{ '--c': store?.color }}
      role="dialog"
      aria-modal="true"
      aria-label="Dictado por voz"
    >
      <button className="icon-btn voice-close" aria-label="Cancelar" onClick={onCancel}>
        <Icon d={ICONS.close} size={26} />
      </button>
      <span className="voice-target">
        {store ? (
          <>
            <StoreMark store={store} size={28} /> Apuntando en {inName(store)}
          </>
        ) : (
          'Di el producto y, si quieres, el súper'
        )}
      </span>
      <p className={'voice-text' + (text ? '' : ' hint')} aria-live="polite">
        {text ? text.charAt(0).toUpperCase() + text.slice(1) : (
          <>
            <span>Prueba con</span>
            <span className="voice-example" key={example}>«{examples[example % examples.length]}»</span>
          </>
        )}
      </p>
      <button className="voice-orb" aria-label="Terminar" onClick={onFinish}>
        <span className="ring" />
        <span className="ring r2" />
        <span className="halo" />
        <span className="orb-core">
          <Icon d={ICONS.mic} size={46} />
        </span>
      </button>
      <p className="voice-help">{text ? 'Toca el micro cuando acabes' : 'Te escucho…'}</p>
    </div>
  );
}

/* ---------------- Pantalla inicial ---------------- */
function HomeScreen({
  stores, items, voiceOk, onStartVoice, onOpenStore, onAddItem, onVoiceAdd, onNotice, onAddStore, sync, onJoin,
}) {
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [storeId, setStoreId] = useState(ANY); // si no se elige súper, va a cualquier súper
  const [addingStore, setAddingStore] = useState(false);
  const [sharing, setSharing] = useState(false);
  const nameRef = useRef(null);
  const choices = [ANY_STORE, ...stores];

  useEffect(() => {
    if (storeId !== ANY && !stores.some((s) => s.id === storeId)) setStoreId(ANY);
  }, [stores, storeId]);

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onAddItem(name, storeId, qty);
    setName('');
    setQty('');
    nameRef.current?.focus(); // para seguir añadiendo sin volver a tocar el campo
  };

  // «queso carrefour» se apunta en Carrefour; si no se dice el súper, en cualquier súper (se puede mover luego)
  const onVoice = (matches) => {
    const v = parseVoice(matches, choices);
    if (v.name) onVoiceAdd(v, v.storeId ?? ANY);
    else onNotice('No te he entendido. Prueba otra vez');
  };

  const totalPending = items.filter((i) => !i.done).length;
  const selected = choices.find((s) => s.id === storeId);
  const pendingStores = [...stores, ANY_STORE]
    .filter((s) => items.some((i) => i.storeId === s.id && !i.done))
    .map(inName);
  const today = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="screen">
      {/* La cabecera del inicio no es fija: esto tapa lo que pase por detrás de la barra de estado */}
      <div className="status-scrim" aria-hidden="true" />
      <header className="home-head">
        <div className="brand-row">
          <span className="app-mark" aria-hidden="true">
            <Icon d={ICONS.cart} size={17} />
          </span>
          <span className="app-name">ToBuy</span>
          <span className="today">{today}</span>
          {sync.status !== 'off' && (
            <button
              className={'share-btn' + (sync.members > 1 ? ` shared ${sync.status}` : '')}
              aria-label="Lista compartida"
              title="Lista compartida"
              onClick={() => setSharing(true)}
            >
              <Icon d={ICONS.people} size={19} />
            </button>
          )}
        </div>
        <h1 className="home-title">
          {totalPending === 0 ? (
            'Nada pendiente'
          ) : (
            <>
              <span className="count">{totalPending}</span> {totalPending === 1 ? 'cosa' : 'cosas'} por comprar
            </>
          )}
        </h1>
        <p className="home-sub">
          {totalPending === 0
            ? 'Apunta aquí lo que te vaya faltando'
            : pendingStores.length <= 3
              ? `en ${pendingStores.join(', ').replace(/, ([^,]*)$/, ' y $1')}`
              : `en ${pendingStores.length} supermercados`}
        </p>
      </header>

      <form onSubmit={submit} className="card quick-add" style={{ '--c': selected?.color }}>
        <div className="input-row">
          <input
            ref={nameRef}
            className="grow"
            placeholder="Añade un producto…"
            enterKeyHint="done"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input className="qty" placeholder="Cant." value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        {/* El súper y el botón solo aparecen al escribir, para que el inicio quede despejado */}
        {name.trim() && (
          <div className="quick-add-more">
            <div className="chips" role="radiogroup" aria-label="Supermercado">
              {choices.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  role="radio"
                  aria-checked={s.id === storeId}
                  className={'chip' + (s.id === storeId ? ' active' : '')}
                  style={{ '--c': s.color }}
                  onClick={() => setStoreId(s.id)}
                >
                  <StoreMark store={s} size={26} />
                  {s.name}
                </button>
              ))}
            </div>
            <button className="primary" type="submit">
              Añadir a {inName(selected ?? ANY_STORE)}
            </button>
          </div>
        )}
      </form>

      <h2 className="section-title">Tus supermercados</h2>
      <div className="stores">
        <StoreCard
          store={ANY_STORE}
          items={items.filter((i) => i.storeId === ANY)}
          onOpen={() => onOpenStore(ANY)}
        />
        {stores.map((s) => (
          <StoreCard
            key={s.id}
            store={s}
            items={items.filter((i) => i.storeId === s.id)}
            onOpen={() => onOpenStore(s.id)}
          />
        ))}
        <button className="store-card add" onClick={() => setAddingStore(true)}>
          <span className="add-icon">
            <Icon d={ICONS.plus} size={24} />
          </span>
          Añadir súper
        </button>
      </div>

      {voiceOk && <VoiceButton label="Dime qué necesitas" onClick={() => onStartVoice(onVoice)} />}

      {addingStore && (
        <AddStoreSheet
          stores={stores}
          onAdd={(n) => {
            onAddStore(n);
            setAddingStore(false);
          }}
          onClose={() => setAddingStore(false)}
        />
      )}

      {sharing && (
        <ShareSheet
          sync={sync}
          hasItems={items.length > 0}
          onJoin={async (code) => {
            await onJoin(code);
            setSharing(false);
          }}
          onNotice={onNotice}
          onClose={() => setSharing(false)}
        />
      )}
    </div>
  );
}

// Dirección de la versión web (GitHub Pages): desde ahí se instala en el iPhone
const WEB_URL = 'https://aropero8.github.io/tobuy/';

const SYNC_STATUS = {
  connecting: 'Conectando…',
  ok: 'Sincronizada',
  offline: 'Sin conexión: los cambios se enviarán al volver',
  error: 'No se puede acceder a la lista',
};

// Lista compartida: el código de esta lista para pasárselo a otro, y unirse a la de otro con el suyo
function ShareSheet({ sync, hasItems, onJoin, onNotice, onClose }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const codeRef = useRef(null);
  const message =
    `Apunta conmigo la lista de la compra en ToBuy. En el iPhone, abre ${WEB_URL} en Safari y añádela a la ` +
    `pantalla de inicio (botón Compartir). Después toca el botón de las personas y pega este código en «Unirme»:\n` +
    sync.listId;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sync.listId);
      onNotice('Código copiado');
    } catch {
      codeRef.current?.select();
      onNotice('Mantén pulsado el código para copiarlo');
    }
  };

  const join = async (e) => {
    e.preventDefault();
    if (!code.trim() || busy) return;
    if (hasItems && !confirm('Dejarás de ver tu lista actual y verás la compartida. ¿Seguir?')) return;
    setBusy(true);
    setError('');
    try {
      await onJoin(code);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Sheet title="Lista compartida" onClose={onClose}>
      <p className={'sync-status ' + sync.status}>
        <span className="dot" aria-hidden="true" />
        {SYNC_STATUS[sync.status]}
      </p>
      <p className="share-note">
        {sync.members > 1
          ? `Compartida entre ${sync.members} móviles: lo que apuntéis aparece en todos.`
          : 'De momento solo está en este móvil. Pásale el código a quien quieras para apuntar juntos.'}
      </p>

      <h3 className="sheet-subtitle">Código de tu lista</h3>
      <div className="share-code">
        <input
          ref={codeRef}
          readOnly
          value={sync.listId ?? 'Conectando…'}
          aria-label="Código de tu lista"
          onFocus={(e) => e.target.select()}
        />
        <button className="primary small" disabled={!sync.listId} onClick={copy}>Copiar</button>
      </div>
      {navigator.share && (
        <button
          className="photo-action share-send"
          disabled={!sync.listId}
          onClick={() => navigator.share({ title: 'ToBuy', text: message }).catch(() => {})}
        >
          <Icon d={ICONS.share} /> Enviar invitación
        </button>
      )}

      <h3 className="sheet-subtitle">¿Te han pasado un código?</h3>
      <form className="share-code" onSubmit={join}>
        <input
          placeholder="Pega aquí el código"
          value={code}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => {
            setCode(e.target.value);
            setError('');
          }}
        />
        <button className="primary small" type="submit" disabled={!code.trim() || busy}>
          {busy ? 'Uniendo…' : 'Unirme'}
        </button>
      </form>
      {error && <p className="share-error" role="alert">{error}</p>}
    </Sheet>
  );
}

// Tarjeta de un súper en el inicio: logo arriba y, debajo, lo pendiente sobre su color
function StoreCard({ store, items, onOpen }) {
  const pending = items.filter((i) => !i.done);
  const done = items.length - pending.length;
  return (
    <button className={'store-card' + (store.id === ANY ? ' any' : '')} style={{ '--c': store.color }} onClick={onOpen}>
      <span className="store-card-logo">
        <StoreLogo store={store} />
      </span>
      <span className="store-card-body">
        <span className="store-count">
          {pending.length > 0 ? (
            <>
              <b>{pending.length}</b> {pending.length === 1 ? 'pendiente' : 'pendientes'}
            </>
          ) : items.length > 0 ? (
            <>
              <Icon d={ICONS.check} size={18} /> Todo listo
            </>
          ) : (
            'Lista vacía'
          )}
        </span>
        <span className="store-preview">
          {pending.length > 0
            ? pending.map((i) => i.name).join(', ')
            : items.length > 0
              ? `${done} en el carro`
              : store.id === ANY
                ? 'Lo que te da igual dónde comprar'
                : 'Toca para apuntar'}
        </span>
        {items.length > 0 && (
          <span className="store-progress" aria-hidden="true">
            <span style={{ width: `${(done / items.length) * 100}%` }} />
          </span>
        )}
      </span>
    </button>
  );
}

// Nuevo súper: escribiendo el nombre o tocando uno de los conocidos que aún no estén
function AddStoreSheet({ stores, onAdd, onClose }) {
  const [name, setName] = useState('');
  const taken = new Set(stores.map((s) => brandOf(s.name)));
  const suggestions = BRANDS.filter((b) => !taken.has(b));
  const preview = { name: name.trim() || '?', color: colorFor(name, stores) };

  const submit = (e) => {
    e.preventDefault();
    if (name.trim()) onAdd(name);
  };

  return (
    <Sheet title="Nuevo supermercado" onClose={onClose}>
      <form className="new-store" onSubmit={submit}>
        <StoreMark store={preview} size={46} />
        <input placeholder="Nombre del súper" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="primary small" type="submit" disabled={!name.trim()}>Crear</button>
      </form>
      {suggestions.length > 0 && (
        <>
          <h3 className="sheet-subtitle">O elige uno</h3>
          <div className="brand-grid">
            {suggestions.map((b) => (
              <button key={b.name} className="brand-tile" title={b.name} onClick={() => onAdd(b.name)}>
                <img src={b.logo} alt={b.name} />
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}

/* ---------------- Pantalla de un supermercado ---------------- */
function StoreScreen({
  store, stores, items, photos, onSetPhoto, voiceOk, onStartVoice, onBack, onAdd, onVoiceAdd, onNotice, onToggle, onDelete, onMove,
  onClearDone, onDeleteStore,
}) {
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [moving, setMoving] = useState(null); // producto que se está moviendo a otro súper
  const [photoFor, setPhotoFor] = useState(null); // producto del que se está eligiendo la foto
  const nameRef = useRef(null);

  // En un súper, lo de cualquier súper va en su propia sección; lo comprado, todo junto
  const isAny = store.id === ANY;
  const todo = items.filter((i) => !i.done && i.storeId === store.id);
  const todoAny = isAny ? [] : items.filter((i) => !i.done && i.storeId === ANY);
  const done = items.filter((i) => i.done);
  const pending = todo.length + todoAny.length;
  const progress = items.length ? done.length / items.length : 0;
  const choices = [ANY_STORE, ...stores];

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd(name, qty);
    setName('');
    setQty('');
    nameRef.current?.focus();
  };

  // Por voz se apunta en este súper, salvo que se nombre otro («queso carrefour»)
  const onVoice = (matches) => {
    const v = parseVoice(matches, choices);
    if (v.name) onVoiceAdd(v, v.storeId ?? store.id);
    else onNotice('No te he entendido. Prueba otra vez');
  };

  const renderItem = (i) => {
    const photo = photos[norm(i.name)];
    return (
      <li key={i.id} className={'item' + (i.done ? ' done' : '')}>
        <label>
          <input type="checkbox" checked={i.done} onChange={() => onToggle(i.id)} />
          <span className="check" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16"><path d={ICONS.check} /></svg>
          </span>
          {/* Un botón dentro de la etiqueta no marca la casilla al tocarlo */}
          <button
            type="button"
            className={'thumb' + (photo ? '' : ' blank')}
            aria-label={photo ? `Foto de ${i.name}` : `Añadir foto de ${i.name}`}
            onClick={() => setPhotoFor(i)}
          >
            {photo ? <img src={photo} alt="" /> : <Icon d={ICONS.camera} size={18} />}
          </button>
          <span className="item-name">{i.name}</span>
          {i.qty && <span className="item-qty">{i.qty}</span>}
        </label>
        <button className="icon" title="Mover a otro súper" aria-label="Mover a otro súper" onClick={() => setMoving(i)}>
          <Icon d={ICONS.move} size={18} />
        </button>
        <button className="icon danger" title="Borrar" aria-label="Borrar" onClick={() => onDelete(i.id)}>
          <Icon d={ICONS.close} size={18} />
        </button>
      </li>
    );
  };

  return (
    <div className="screen" style={{ '--c': store.color }}>
      <header className="topbar store">
        <div className="topbar-row">
          <button className="icon-btn" aria-label="Volver" onClick={onBack}>
            <Icon d={ICONS.back} size={26} />
          </button>
          <h1 className="logo-plate">
            <span className="plate">
              <StoreLogo store={store} />
            </span>
          </h1>
          {isAny ? (
            <span className="icon-btn" aria-hidden="true" /> // cualquier súper no se borra; esto deja el logo centrado
          ) : (
            <button className="icon-btn" title="Borrar supermercado" aria-label="Borrar supermercado" onClick={onDeleteStore}>
              <Icon d={ICONS.trash} />
            </button>
          )}
        </div>
        <div className="store-status">
          <span>
            {items.length === 0
              ? 'Lista vacía'
              : pending === 0
                ? '¡Todo en el carro!'
                : `${done.length} de ${items.length} en el carro`}
          </span>
          {items.length > 0 && (
            <span className="progress" aria-hidden="true">
              <span style={{ width: `${progress * 100}%` }} />
            </span>
          )}
        </div>
      </header>

      <form onSubmit={submit} className="card quick-add row">
        <input
          ref={nameRef}
          className="grow"
          placeholder="Añade un producto…"
          enterKeyHint="done"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input className="qty" placeholder="Cant." value={qty} onChange={(e) => setQty(e.target.value)} />
        <button className="primary round" type="submit" aria-label="Añadir" disabled={!name.trim()}>
          <Icon d={ICONS.plus} />
        </button>
      </form>

      {items.length === 0 && (
        <div className="empty">
          <div className="empty-icon">🧺</div>
          <p>
            {isAny
              ? 'Apunta aquí lo que te da igual dónde comprar: saldrá en la lista de todos los súper.'
              : `No tienes nada apuntado para ${store.name}.`}
          </p>
          {voiceOk && <p className="empty-hint">Pulsa el micro de abajo y dilo en voz alta.</p>}
        </div>
      )}

      {items.length > 0 && pending === 0 && (
        <div className="empty small">
          <div className="empty-icon">🎉</div>
          <p>¡Ya lo tienes todo!</p>
        </div>
      )}

      {todo.length > 0 && <ul className="list">{todo.map(renderItem)}</ul>}

      {todoAny.length > 0 && (
        <>
          <h2 className="section-title any-title">
            <StoreMark store={ANY_STORE} size={20} /> En cualquier súper · {todoAny.length}
          </h2>
          <ul className="list">{todoAny.map(renderItem)}</ul>
        </>
      )}

      {done.length > 0 && (
        <>
          <div className="done-header">
            <h2 className="section-title">En el carro · {done.length}</h2>
            <button className="link" onClick={onClearDone}>Quitar de la lista</button>
          </div>
          <ul className="list">{done.map(renderItem)}</ul>
        </>
      )}

      {voiceOk && <VoiceButton label="Dime qué falta" onClick={() => onStartVoice(onVoice)} />}

      {photoFor && (
        <PhotoSheet
          item={photoFor}
          photo={photos[norm(photoFor.name)]}
          onSet={(photo) => {
            onSetPhoto(photoFor.name, photo);
            setPhotoFor(null);
          }}
          onNotice={onNotice}
          onClose={() => setPhotoFor(null)}
        />
      )}

      {moving && (
        <Sheet title={`Mover «${moving.name}» a…`} onClose={() => setMoving(null)}>
          <div className="move-list">
            {choices.filter((s) => s.id !== moving.storeId).map((s) => (
              <button
                key={s.id}
                className="move-option"
                onClick={() => {
                  onMove(moving.id, s.id);
                  setMoving(null);
                }}
              >
                <StoreMark store={s} size={40} />
                <span className="grow">{s.name}</span>
                <Icon d={ICONS.chevron} size={18} />
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}

/* ---------------- Foto de un producto ---------------- */
// Hoja para elegir la foto: de internet (Wikipedia y Open Food Facts), con la cámara o de la galería.
// La foto se guarda por nombre, así que vale para todas las veces que se apunte ese producto.
function PhotoSheet({ item, photo, onSet, onNotice, onClose }) {
  const [results, setResults] = useState(null); // null: buscando; 'error': sin conexión
  const [busy, setBusy] = useState(false);
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);

  useEffect(() => {
    let alive = true;
    searchPhotos(item.name).then(
      (r) => alive && setResults(r),
      () => alive && setResults('error')
    );
    return () => {
      alive = false;
    };
  }, [item.name]);

  // Se guarda una miniatura; si una foto de internet no se deja copiar, se guarda su dirección
  const choose = async (source) => {
    if (busy) return;
    setBusy(true);
    try {
      onSet(await makeThumb(source));
    } catch {
      if (typeof source === 'string') onSet(source);
      else onNotice('No se ha podido abrir esa foto');
    } finally {
      setBusy(false);
    }
  };
  const onFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) choose(file);
  };

  return (
    <Sheet title={`Foto de «${item.name}»`} onClose={onClose}>
      {photo && (
        <div className="photo-current">
          <img src={photo} alt={item.name} />
          <button className="link danger" onClick={() => onSet(null)}>Quitar foto</button>
        </div>
      )}
      <div className="photo-actions">
        <button className="photo-action" disabled={busy} onClick={() => cameraRef.current?.click()}>
          <Icon d={ICONS.camera} /> Hacer foto
        </button>
        <button className="photo-action" disabled={busy} onClick={() => galleryRef.current?.click()}>
          <Icon d={ICONS.image} /> Galería
        </button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
        <input ref={galleryRef} type="file" accept="image/*" hidden onChange={onFile} />
      </div>
      <h3 className="sheet-subtitle">De internet</h3>
      {results === null ? (
        <div className="photo-grid" aria-busy="true">
          {Array.from({ length: 6 }, (_, n) => <span key={n} className="photo-tile loading" />)}
        </div>
      ) : results === 'error' ? (
        <p className="photo-note">Sin conexión. Puedes hacer una foto o elegirla de la galería.</p>
      ) : results.length === 0 ? (
        <p className="photo-note">No he encontrado fotos de «{item.name}».</p>
      ) : (
        <>
          <div className="photo-grid">
            {results.map((r) => (
              <button key={r.url} className="photo-tile" title={r.label} disabled={busy} onClick={() => choose(r.url)}>
                <img src={r.url} alt={r.label} loading="lazy" />
              </button>
            ))}
          </div>
          <p className="photo-note small">Fotos de Wikipedia{offAvailable && ' y Open Food Facts'}</p>
        </>
      )}
    </Sheet>
  );
}

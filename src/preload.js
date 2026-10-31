// Lee la canción actual de la barra del reproductor y la manda al proceso principal.
const { ipcRenderer } = require('electron');

// YT a veces crea una segunda ytmusic-player-bar oculta; la visible es la del slot "player-bar".
const MAIN_BAR = 'ytmusic-player-bar[slot="player-bar"]';

let last = '';
let lastArt = '';
let boundVideo = null;
let lastTime = '';

// Tiempo transcurrido y total a los lados de la barra de progreso (theme.css los pinta con attr()).
// Se engancha a timeupdate del vídeo y solo escribe cuando cambia el texto (≈ una vez por segundo).
function syncTime() {
  const label = document.querySelector(`${MAIN_BAR} .time-info`);
  const bar = document.querySelector(`${MAIN_BAR} #progress-bar`);
  if (!label || !bar) return;
  const text = label.textContent.trim();
  if (text === lastTime) return;
  lastTime = text;
  const [elapsed = '', total = ''] = text.split('/').map((s) => s.trim());
  bar.setAttribute('data-md-elapsed', elapsed);
  bar.setAttribute('data-md-total', total);
}

// Reordena la barra moviendo nodos (no con posiciones calculadas), para que el propio flujo de
// YT reparta el espacio y nada se pise a ningún tamaño de ventana. Los elementos movidos siguen
// siendo los mismos, así que YT los sigue controlando. Es idempotente: si YT vuelve a pintar la
// barra, la siguiente pasada lo recoloca.
// La píldora de "me gusta" NO se mueve: si sale de su contenedor original, YT trata sus clics
// como clics en la barra (abre Now Playing y el "me gusta" deja de responder). Se queda donde
// está y theme.css la dibuja junto al volumen con anclaje CSS.
function arrangeBar(bar) {
  const right = bar.querySelector('#right-controls');
  const rightButtons = right && right.querySelector('.right-controls-buttons');
  const center = bar.querySelector('#left-controls');
  // Menú "⋮" en la columna central, al final de la fila de botones (sobre el tiempo total).
  const menu = bar.querySelector('.middle-controls ytmusic-menu-renderer');
  if (menu && center) center.appendChild(menu);
  // Control de volumen: el deslizador pasa a un panel flotante sobre su botón, así no reserva
  // 100 px vacíos en la barra. Se envuelven botón y deslizador para anclar el panel.
  const volume = rightButtons && rightButtons.querySelector('.volume');
  const slider = bar.querySelector('#volume-slider');
  if (volume && slider && !(volume.parentElement && volume.parentElement.classList.contains('md-volume'))) {
    const wrap = document.createElement('span');
    wrap.className = 'md-volume';
    volume.before(wrap);
    wrap.append(volume, slider);
  }
}

// Textos que manda main.js (IPC 'strings'); el preload en sandbox no puede cargar src/lib/i18n.js.
let strings = {};
function labelNav(btn, key) {
  const text = strings[key];
  if (!text) return;
  if (btn.title !== text) btn.title = text;
  if (btn.getAttribute('aria-label') !== text) btn.setAttribute('aria-label', text);
}
ipcRenderer.on('strings', (_e, msg) => {
  strings = (msg && msg.strings) || {};
  for (const [cls, key] of NAV_BUTTONS) {
    const btn = document.querySelector(`ytmusic-nav-bar > .${cls}`);
    if (btn) labelNav(btn, key);
  }
  const home = document.querySelector('body > .md-home');
  if (home) labelHome(home);
  if (gear) labelGear();
  if (panel) renderSettings();
});
const txt = (key) => strings[key] || key;
// Botones "atrás" y "adelante" en la barra superior (YT Music no los trae; como en Spotify). YT
// navega con el historial del navegador, así que basta con history.back()/forward(); cada uno se
// desactiva cuando no hay a dónde ir.
const NAV_BUTTONS = [['md-back', 'nav.back'], ['md-forward', 'nav.forward']];
function updateNav(nav) {
  const n = window.navigation;
  const can = { 'md-back': n ? n.canGoBack : history.length > 1, 'md-forward': n ? n.canGoForward : false };
  for (const [cls] of NAV_BUTTONS) {
    const btn = nav.querySelector(`:scope > .${cls}`);
    if (btn && btn.disabled === can[cls]) btn.disabled = !can[cls];
  }
}
function ensureBackButton() {
  const nav = document.querySelector('ytmusic-nav-bar');
  if (!nav) return;
  for (const [cls, key] of NAV_BUTTONS) {
    let btn = nav.querySelector(`:scope > .${cls}`);
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = cls;
      btn.addEventListener('click', () => (cls === 'md-back' ? history.back() : history.forward()));
      nav.appendChild(btn);
      if (cls === 'md-back' && window.navigation) window.navigation.addEventListener('currententrychange', () => updateNav(nav));
    }
    labelNav(btn, key);
  }
  updateNav(nav);
}

// Botón "volver a YouTube Music" en las páginas de Google (inicio de sesión, consentimiento):
// allí no existe la barra de YT, así que el botón atrás de arriba no aparece y no habría salida.
// Flota centrado arriba (chrome.css), lejos del formulario, del logo y de los botones de la ventana.
function labelHome(btn) {
  const text = strings['nav.home'];
  if (!text) return;
  if (btn.title !== text) btn.title = text;
  if (btn.getAttribute('aria-label') !== text) btn.setAttribute('aria-label', text);
}
function ensureHomeButton() {
  if (location.hostname === 'music.youtube.com' || !document.body) return;
  let btn = document.querySelector('body > .md-home');
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'md-home';
    btn.textContent = 'YouTube Music';
    btn.addEventListener('click', () => location.assign('https://music.youtube.com/'));
    document.body.appendChild(btn);
  }
  labelHome(btn);
}

// --- Engranaje y menú de ajustes ---
// Botón entre "enviar a dispositivo" y el avatar; abre un panel bajo él con los ajustes de la
// bandeja y los del menú rápido (plegados en su fila). Los valores viven en main.js
// ('settings:get' / 'settings:set'); si cambian desde la bandeja llega 'settings:changed'.
// Cerrado no cuesta nada: los oyentes de clic fuera y de tamaño solo existen con el panel abierto.
let gear = null;
let panel = null; // div.md-settings mientras está abierto
let state = null; // lo último que respondió main
let expanded = false; // sub-bloque del menú rápido desplegado
let recordingKey = false; // grabando un atajo nuevo
let shortcutError = ''; // 'taken' | 'invalid' | 'reserved' del último intento
const SHORTCUT_ERRORS = { taken: 'set.shortcutTaken', invalid: 'set.shortcutInvalid', reserved: 'set.shortcutReserved' };
let updateStatus = ''; // estado del botón de actualizaciones del pie
const UPDATE_LABELS = { '': 'upd.check', checking: 'upd.checking', installing: 'upd.checking', latest: 'upd.latest', unsupported: 'upd.unsupported', error: 'upd.error' };

function labelGear() {
  const text = txt('set.title');
  if (gear.title !== text) gear.title = text;
  if (gear.getAttribute('aria-label') !== text) gear.setAttribute('aria-label', text);
}
function ensureGear() {
  const right = document.querySelector('ytmusic-nav-bar #right-content');
  if (!right) return;
  if (!gear) {
    gear = document.createElement('button');
    gear.type = 'button';
    gear.className = 'md-gear';
    gear.setAttribute('aria-haspopup', 'true');
    gear.setAttribute('aria-expanded', 'false');
    gear.addEventListener('click', () => (panel ? closeSettings() : openSettings()));
  }
  // Justo antes del avatar; sin sesión iniciada no hay avatar y va al final.
  const avatar = right.querySelector(':scope > ytmusic-settings-button');
  if (avatar ? gear.nextElementSibling !== avatar : gear.parentElement !== right) right.insertBefore(gear, avatar);
  labelGear();
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
// Fila pulsable: etiqueta a la izquierda y, opcionalmente, algo a la derecha.
function row(key, label, onClick, extra) {
  const b = el('button', 'md-set-row');
  b.type = 'button';
  b.dataset.key = key;
  b.append(el('span', 'md-set-label', label));
  if (extra) b.append(extra);
  b.addEventListener('click', onClick);
  return b;
}
function radio(key, label, on, disabled, onClick) {
  const b = row(key, label, onClick);
  b.classList.add('md-set-radio');
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-checked', String(on));
  b.prepend(el('span', 'md-rad' + (on ? ' on' : '')));
  b.disabled = disabled;
  return b;
}
function group(label, dim, ...rows) {
  const g = el('div', 'md-set-group' + (dim ? ' md-dim' : ''));
  g.setAttribute('role', 'radiogroup');
  g.setAttribute('aria-label', label);
  g.append(el('div', 'md-set-cap', label), ...rows);
  return g;
}

function renderSettings() {
  if (!panel || !state) return;
  // Se redibuja entero (son una docena de nodos); el foco vuelve a la misma fila.
  const focused = panel.contains(document.activeElement) ? document.activeElement.dataset.key : null;
  const qm = state.quickMenu;
  const kbd = (text) => el('kbd', 'md-kbd', text);
  const right = el('span', 'md-set-r');
  if (!expanded) right.append(kbd(state.display.shortcut));
  right.append(el('span', 'md-chev' + (expanded ? ' open' : '')));
  const head = row('qm', txt('set.quickMenu'), () => { expanded = !expanded; stopRecording(); shortcutError = ''; renderSettings(); }, right);
  head.setAttribute('aria-expanded', String(expanded));
  const nodes = [head];
  if (expanded) {
    const sub = el('div', 'md-set-sub');
    const value = recordingKey ? el('span', 'md-set-hint', txt('set.shortcutHint')) : el('span', 'md-set-r');
    if (!recordingKey) value.append(kbd(state.display.shortcut));
    const shortcut = row('shortcut', txt('set.shortcut'), () => { if (recordingKey) stopRecording(); else startRecording(); renderSettings(); }, value);
    shortcut.classList.toggle('recording', recordingKey);
    sub.append(shortcut);
    if (shortcutError) {
      const err = el('div', 'md-set-err', txt(SHORTCUT_ERRORS[shortcutError] || 'set.shortcutInvalid'));
      err.setAttribute('role', 'alert');
      sub.append(err);
    }
    const setQm = (patch) => () => changeSettings({ quickMenu: patch });
    const global = qm.reach === 'global';
    sub.append(
      group(txt('set.works'), false,
        radio('reach-focused', txt('set.focused'), !global, false, setQm({ reach: 'focused' })),
        radio('reach-global', txt('set.anywhere'), global, false, setQm({ reach: 'global' }))),
      group(txt('set.fromOtherApps'), !global,
        radio('from-float', txt('set.float'), qm.fromOtherApps === 'float', !global, setQm({ fromOtherApps: 'float' })),
        radio('from-front', txt('set.front'), qm.fromOtherApps === 'front', !global, setQm({ fromOtherApps: 'front' }))),
      group(txt('set.shiftEnter'), false,
        radio('shift-queue', txt('set.queue'), qm.shiftEnter === 'queue', false, setQm({ shiftEnter: 'queue' })),
        radio('shift-next', txt('set.next'), qm.shiftEnter === 'next', false, setQm({ shiftEnter: 'next' }))),
    );
    nodes.push(sub);
  }
  nodes.push(el('div', 'md-set-sep'));
  for (const [key, label] of [['theme', 'set.theme'], ['notifications', 'set.notify'], ['closeToTray', 'set.closeToTray'], ['startWithWindows', 'set.startWithWindows']]) {
    const sw = row(key, txt(label), () => changeSettings({ [key]: !state[key] }), el('span', 'md-sw' + (state[key] ? ' on' : '')));
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-checked', String(!!state[key]));
    nodes.push(sw);
  }
  nodes.push(el('div', 'md-set-sep'));
  const foot = el('div', 'md-set-foot');
  const check = el('button', 'md-set-btn', txt(UPDATE_LABELS[updateStatus]));
  check.type = 'button';
  check.dataset.key = 'update';
  check.disabled = updateStatus === 'checking' || updateStatus === 'installing';
  check.addEventListener('click', checkUpdates);
  foot.append(el('span', 'md-set-ver', `ByTune ${state.version}`), check);
  nodes.push(foot);
  panel.replaceChildren(...nodes);
  panel.setAttribute('aria-label', txt('set.title'));
  if (focused) panel.querySelector(`[data-key="${focused}"]`)?.focus();
}

function changeSettings(patch) {
  return ipcRenderer.invoke('settings:set', patch).then((res) => {
    if (res && res.error) shortcutError = res.error;
    else if (res) { state = res; shortcutError = ''; }
    renderSettings();
  }).catch(() => {});
}

// main responde 'latest' | 'unsupported' | 'error' | 'installing' (y entonces la app se cierra).
function checkUpdates() {
  updateStatus = 'checking';
  renderSettings();
  ipcRenderer.invoke('update:check').catch(() => 'error').then((res) => {
    updateStatus = res in UPDATE_LABELS ? res : 'error';
    renderSettings();
  });
}

function startRecording() {
  recordingKey = true;
  shortcutError = '';
  ipcRenderer.send('settings:recording', true); // main deja de atender sus atajos mientras tanto
}
function stopRecording() {
  if (!recordingKey) return;
  recordingKey = false;
  ipcRenderer.send('settings:recording', false);
}

// Coloca el panel bajo el engranaje, alineado por la derecha y sin salirse de la ventana.
function placeSettings() {
  const r = gear.getBoundingClientRect();
  const width = 320;
  panel.style.top = `${Math.round(r.bottom + 8)}px`;
  panel.style.left = `${Math.round(Math.max(8, Math.min(r.right - width, innerWidth - width - 8)))}px`;
}

function onOutside(e) {
  const path = e.composedPath();
  if (!path.includes(panel) && !path.includes(gear)) closeSettings();
}

async function openSettings() {
  if (panel) return;
  const res = await ipcRenderer.invoke('settings:get').catch(() => null);
  if (!res || panel || !gear || !gear.isConnected) return;
  state = res;
  expanded = false;
  shortcutError = '';
  if (updateStatus !== 'checking') updateStatus = '';
  panel = el('div', 'md-settings');
  panel.setAttribute('role', 'dialog');
  renderSettings();
  document.body.append(panel);
  placeSettings();
  gear.setAttribute('aria-expanded', 'true');
  document.addEventListener('pointerdown', onOutside, true);
  window.addEventListener('resize', closeSettings);
  window.addEventListener('blur', closeSettings);
}
function closeSettings() {
  if (!panel) return;
  stopRecording();
  document.removeEventListener('pointerdown', onOutside, true);
  window.removeEventListener('resize', closeSettings);
  window.removeEventListener('blur', closeSettings);
  panel.remove();
  panel = null;
  if (gear) gear.setAttribute('aria-expanded', 'false');
}

ipcRenderer.on('settings:changed', (_e, next) => {
  if (!next) return;
  state = next;
  if (panel) renderSettings();
});

// Teclado con el panel abierto. Se registra ya (antes que los scripts de YT) y en captura sobre
// window, así va primero: grabando, ninguna tecla llega a YouTube; si no, Esc cierra el panel.
window.addEventListener('keydown', (e) => {
  if (!panel) return;
  if (recordingKey) {
    e.preventDefault();
    e.stopImmediatePropagation();
    // Esc a secas cancela; con modificadores (Ctrl+Mayús+Esc…) se graba como cualquier otra.
    if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) { stopRecording(); renderSettings(); return; }
    if (e.repeat) return;
    const ev = { key: e.key, code: e.code, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, metaKey: e.metaKey };
    // main traduce la pulsación (src/lib/shortcut.js); null = solo modificadores, se sigue grabando.
    ipcRenderer.invoke('settings:key', ev).then((acc) => {
      if (!acc || !recordingKey) return;
      stopRecording();
      return changeSettings({ quickMenu: { accelerator: acc } });
    }).catch(() => {});
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopImmediatePropagation();
    closeSettings();
    gear.focus();
  }
}, true);

// Portadas de las playlists de la barra lateral (como Spotify). main.js manda el mapa
// { browseId: url }; covers.js marca cada entrada con data-md-id. Solo se toca el DOM si falta
// la miniatura o cambió su portada.
let covers = {};
ipcRenderer.on('covers', (_e, map) => { covers = map || {}; applyCovers(); });
function applyCovers() {
  for (const entry of document.querySelectorAll('ytmusic-guide-entry-renderer[data-md-id]')) {
    const url = covers[entry.dataset.mdId];
    const item = entry.querySelector('tp-yt-paper-item');
    if (!url || !item) continue;
    let img = item.querySelector(':scope > img.md-cover');
    if (!img) {
      img = document.createElement('img');
      img.className = 'md-cover';
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      item.prepend(img);
    }
    if (img.getAttribute('src') !== url) img.src = url;
  }
}

// Puente de las letras: lyrics-view.js corre en la página (sin ipcRenderer). Deja el mensaje
// en <html data-md-lyrics-msg> y lanza el evento 'md-lyrics'; aquí se lee, se borra y solo se
// reenvía a main.js lo esperado: pedir la letra de una canción, recordar el panel abierto o
// poner la ventana a pantalla completa.
document.addEventListener('md-lyrics', () => {
  const root = document.documentElement;
  const raw = root.dataset.mdLyricsMsg;
  delete root.dataset.mdLyricsMsg;
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'request' && msg.track && typeof msg.track === 'object') ipcRenderer.send('lyrics:request', msg.track);
  else if (msg.type === 'open' && typeof msg.open === 'boolean') ipcRenderer.send('lyrics:open', msg.open);
  else if (msg.type === 'fullscreen' && typeof msg.on === 'boolean') ipcRenderer.send('np:fullscreen', msg.on);
});

// Ancho de los paneles laterales, ajustable arrastrando su borde (como Spotify). Al soltar cambia
// una variable CSS en <html> (--md-left-w / --md-right-w) y theme.css hace el resto. Mientras se
// arrastra solo se mueve una tarjeta fantasma y se recorta el panel: esa variable la heredan los
// ~13 000 elementos de la página y cambiarla en cada fotograma daba 11 fps en Now Playing.
// main.js guarda los anchos (IPC 'panels') y los manda al cargar.
// Doble clic en el borde vuelve al ancho por defecto; con el foco en él, ← y → lo ajustan.
const PANELS = {
  left: { min: 240, max: 420, cssVar: '--md-left-w', label: 'Ajustar ancho de la barra lateral' },
  right: { min: 280, max: 480, cssVar: '--md-right-w', label: 'Ajustar ancho de la cola' },
};
let panelWidths = {};
ipcRenderer.on('panels', (_e, w) => { panelWidths = w && typeof w === 'object' ? w : {}; applyPanelWidths(); });
function applyPanelWidths() {
  const root = document.documentElement.style;
  for (const [side, cfg] of Object.entries(PANELS)) {
    const v = panelWidths[side];
    if (typeof v === 'number') root.setProperty(cfg.cssVar, `${v}px`);
    else root.removeProperty(cfg.cssVar);
  }
}
const clampPanel = (side, w) => Math.round(Math.min(PANELS[side].max, Math.max(PANELS[side].min, w)));
function savePanels() { ipcRenderer.send('panels', panelWidths); }
function setPanel(side, w) {
  panelWidths[side] = clampPanel(side, w);
  document.documentElement.style.setProperty(PANELS[side].cssVar, `${panelWidths[side]}px`);
}
function currentPanelWidth(side) {
  if (typeof panelWidths[side] === 'number') return panelWidths[side];
  const el = side === 'left' ? document.querySelector('#guide-wrapper') : document.querySelector('ytmusic-player-page #side-panel');
  return el ? el.getBoundingClientRect().width : PANELS[side].min;
}
function makeResizer(side) {
  const h = document.createElement('div');
  h.className = `md-resize md-resize-${side}`;
  h.tabIndex = 0;
  h.setAttribute('role', 'separator');
  h.setAttribute('aria-orientation', 'vertical');
  h.setAttribute('aria-label', PANELS[side].label);
  let pending = null;
  let frame = 0;
  // Vista previa: tarjeta fantasma (mismo sitio y forma que la de verdad, de theme.css) y el panel
  // recortado al borde nuevo. Solo cambian el ancho del fantasma y el recorte del panel: estilo de
  // dos elementos por fotograma.
  let pv = null;
  function startPreview() {
    const el = side === 'left' ? document.querySelector('#guide-wrapper') : document.querySelector('ytmusic-player-page #side-panel');
    if (!el) return;
    const r = el.getBoundingClientRect();
    const c = getComputedStyle(el, '::before');
    const top = parseFloat(c.top);
    const height = side === 'left' ? parseFloat(c.height) : r.height - top - parseFloat(c.bottom);
    const gap = parseFloat(side === 'left' ? c.left : c.right) || 0;
    const ghost = document.createElement('div');
    ghost.className = 'md-resize-ghost';
    Object.assign(ghost.style, { top: `${top}px`, height: `${height}px`, [side]: `${gap}px`, width: `${r.width - gap}px` });
    const cover = document.createElement('div');
    cover.className = 'md-resize-cover';
    // La cola vive dentro de Now Playing (capa propia, z 2): un fantasma en <body> quedaba encima
    // de sus filas. Ahí va justo antes de ella y una capa por debajo (la cola es z 3).
    if (side === 'right') { ghost.style.zIndex = '2'; el.parentElement.insertBefore(ghost, el); }
    else document.body.append(ghost);
    document.body.append(cover);
    document.documentElement.setAttribute('data-md-resizing', side);
    // El contenido no se reacomoda hasta soltar, pero se desliza con el borde (transform: solo
    // mueve la capa ya pintada, sin recalcular nada) hasta donde quedará al soltar.
    pv = { el, ghost, cover, gap, width: r.width, slide: slideTargets() };
    for (const s of pv.slide) s.el.style.willChange = 'transform';
  }
  // Dónde quedará cada pieza con el borde movido d px (medido con el ancho aplicado de verdad, en
  // cada diseño de lyrics.css). Cada una da su transform para d. translate y scale ya los usa
  // lyrics.css: aquí transform, que va dentro de esa escala (de ahí / s).
  function slideTargets() {
    const t = [];
    const add = (el, at) => { if (el && el.offsetWidth) t.push({ el, at }); };
    const shift = (el, k) => { const s = parseFloat(getComputedStyle(el).scale) || 1; add(el, (d) => `translateX(${Math.round(d * k) / s}px)`); };
    const pp = document.querySelector('ytmusic-app-layout[player-page-open]') && document.querySelector('ytmusic-player-page');
    if (!pp) {
      // Las demás páginas: el contenido, pegado a la barra lateral (lo que pasa del borde derecho
      // lo oculta el overflow-x de <body>). El fondo (degradado, foto del artista) lo pinta su
      // contenedor y se queda quieto.
      if (side !== 'left') return t;
      const parts = [...document.querySelectorAll('ytmusic-app-layout > #content > * > div > :is(#header, #content-wrapper)')].filter((e) => e.offsetWidth);
      for (const el of parts.length ? parts : [document.querySelector('ytmusic-app-layout > #content')]) shift(el, 1);
      return t;
    }
    const q = (sel) => pp.querySelector(sel);
    const lyrics = pp.getAttribute('data-md-lyrics') === 'open';
    const narrow = pp.hasAttribute('data-md-lyrics-narrow');
    const L = side === 'left';
    // Botones de la esquina: siguen el borde de la cola.
    if (!L) for (const b of pp.querySelectorAll('#main-panel > .md-np-btn')) shift(b, -1);
    if (!lyrics) {
      // Sin letra la carátula está centrada y además cambia de tamaño: se mueve su centro y el
      // tamaño se ajusta al soltar.
      shift(q('#main-panel > #player'), L ? 0.5 : -0.5);
      shift(q('#main-panel > #md-np-info'), L ? 0.5 : -0.5);
    } else if (narrow) {
      // Miniatura arriba, letra debajo: todo pegado a la barra lateral.
      if (L) for (const sel of ['#main-panel > #player', '#main-panel > #md-np-info', '#md-lyrics']) shift(q(sel), 1);
    } else {
      // Dos columnas: carátula y título centrados en el primer cuarto del panel y encogidos si no
      // caben (lyrics-view.js measure(): mín(ancho, W/2 − 2·24) y centro vertical común).
      const panel = q('#main-panel');
      const cover = q('#main-panel > #player');
      const info = q('#main-panel > #md-np-info');
      shift(q('#md-lyrics'), L ? 0.5 : -0.5);
      if (!panel || !cover || !info) return t;
      const W = panel.offsetWidth;
      const cw = cover.offsetWidth;
      const s0 = parseFloat(getComputedStyle(cover).scale) || 1;
      const yc = (cover.offsetTop + info.offsetTop + info.offsetHeight) / 2;
      for (const el of [cover, info]) {
        const c = el.offsetTop + el.offsetHeight / 2;
        add(el, (d) => {
          const s1 = Math.min(cw, (W - d) / 2 - 48) / cw;
          const dx = (L ? d : 0) - d / 4;
          const dy = (s0 - s1) * (yc - c);
          return `translate(${Math.round(dx) / s0}px, ${Math.round(dy) / s0}px) scale(${s1 / s0})`;
        });
      }
    }
    return t;
  }
  function preview(w) {
    pv.ghost.style.width = `${w - pv.gap}px`;
    const cut = Math.max(0, pv.width - w);
    pv.el.style.clipPath = cut ? (side === 'left' ? `inset(0 ${cut}px 0 0)` : `inset(0 0 0 ${cut}px)`) : '';
    const d = w - pv.width;
    for (const s of pv.slide) s.el.style.transform = d ? s.at(d) : '';
  }
  function endPreview() {
    if (!pv) return;
    pv.ghost.remove();
    pv.cover.remove();
    pv.el.style.clipPath = '';
    for (const s of pv.slide) {
      s.el.style.transform = '';
      s.el.style.willChange = '';
    }
    document.documentElement.removeAttribute('data-md-resizing');
    pv = null;
  }
  const onMove = (e) => {
    pending = side === 'left' ? e.clientX : window.innerWidth - e.clientX;
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      if (pending === null) return;
      if (pv) preview(clampPanel(side, pending));
      else setPanel(side, pending);
    });
  };
  // Fin del arrastre por cualquier camino: soltar, cancelar o perder la captura del puntero. Los
  // eventos se escuchan en window: si la captura falla, llegan a la capa del cursor (que tapa el
  // tirador) y, solo con pointerup en el tirador, la capa se quedaba encima de toda la ventana.
  const END = ['pointerup', 'pointercancel', 'lostpointercapture'];
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    for (const t of END) window.removeEventListener(t, onUp, true);
    if (h.hasPointerCapture(dragId)) h.releasePointerCapture(dragId);
    h.classList.remove('dragging');
    cancelAnimationFrame(frame);
    frame = 0;
    // El ancho de verdad y el fin de la vista previa en la misma tarea: un solo fotograma, sin salto.
    const moved = pending !== null;
    if (moved) { setPanel(side, pending); savePanels(); }
    pending = null;
    endPreview();
    // En Now Playing, lyrics-view recoloca carátula y letra ya (su ResizeObserver llegaría un
    // fotograma tarde: la carátula saltaba a medio camino).
    if (moved && document.querySelector('ytmusic-app-layout[player-page-open]')) document.dispatchEvent(new Event('md-measure'));
  };
  let dragId = 0;
  h.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (pv) onUp(); // un arrastre anterior sin cerrar
    pending = null;
    dragId = e.pointerId;
    try { h.setPointerCapture(dragId); } catch {}
    h.classList.add('dragging');
    startPreview();
    window.addEventListener('pointermove', onMove);
    for (const t of END) window.addEventListener(t, onUp, true);
  });
  h.addEventListener('dblclick', () => { delete panelWidths[side]; applyPanelWidths(); savePanels(); });
  h.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const grow = (e.key === 'ArrowRight') === (side === 'left');
    setPanel(side, currentPanelWidth(side) + (grow ? 16 : -16));
    savePanels();
  });
  document.body.appendChild(h);
}
// Crea los tiradores (una vez) y marca en <html> qué paneles se ven, para mostrar solo esos.
// Solo escribe atributos cuando cambian.
function updateResizers() {
  if (!document.body) return;
  if (!document.querySelector('.md-resize-left')) makeResizer('left');
  if (!document.querySelector('.md-resize-right')) makeResizer('right');
  const app = document.querySelector('ytmusic-app');
  const layout = document.querySelector('ytmusic-app-layout');
  const root = document.documentElement;
  const guideOpen = !!app && !app.hasAttribute('guide-collapsed') && !app.hasAttribute('is-hidden-guide-page') && window.innerWidth >= 936;
  const queueOpen = !!layout && layout.hasAttribute('player-page-open') && window.innerWidth >= 940;
  if (guideOpen !== root.hasAttribute('data-md-guide-open')) root.toggleAttribute('data-md-guide-open', guideOpen);
  if (queueOpen !== root.hasAttribute('data-md-queue-open')) root.toggleAttribute('data-md-queue-open', queueOpen);
}

// Plegar o desplegar la barra lateral: YT cambia --ytmusic-guide-width (heredada por los ~13 000
// elementos de la página) y todo se recoloca de una vez: un recálculo de estilos de ~120 ms en Now
// Playing. Animar esa variable lo repetía en cada fotograma, y una transición de vista congelaba
// la pantalla ~200 ms (fotos de la página antes y después). Aquí, FLIP: en el mismo fotograma del
// cambio (antes de pintarse) lo que se movió vuelve con transform a donde estaba y desde ahí llega a
// su sitio con un muelle; el panel se recorta con la forma de la tarjeta. Nada de fotos: todo sigue
// vivo. Tras el cambio no se lee ninguna medida que obligue a recalcular otra vez (cada lectura
// costaba otro recálculo entero): lo del panel se lee antes y su ancho final se calcula.
const MOTION = { duration: 350, easing: 'cubic-bezier(.2, 0, 0, 1)' };
const GUIDE_MIN = 72; // ancho plegada
const guideWidth = () => { const g = document.querySelector('#guide-wrapper'); return g ? g.getBoundingClientRect().width : 0; };
// Ancho desplegada: el de --md-left-eff (theme.css), sin medir.
const guideOpenWidth = () => Math.min(parseFloat(document.documentElement.style.getPropertyValue('--md-left-w')) || 240, Math.max(240, window.innerWidth / 2 - 164));
// Con Motion (main.js lo inyecta en este mundo), un muelle: Motion lo convierte en una curva
// linear() que el navegador anima solo, en la GPU (sin JS por fotograma). Corto y con poco rebote:
// el recorte no debe pasarse de los 72 px y comerse los iconos.
function guideTiming() {
  if (!globalThis.Motion) return MOTION;
  const [ms, easing] = String(globalThis.Motion.spring(0.28, 0.08)).split('ms ');
  return { duration: +ms, easing };
}
// Lo que se mueve: el contenido de la página (translate, la propiedad que no usa YT) y, en Now
// Playing, la carátula (que además cambia de tamaño), el título y la letra (transform: translate y
// scale ya los usa lyrics.css).
function guideTargets() {
  const t = [];
  if (document.querySelector('ytmusic-app-layout[player-page-open]')) {
    for (const [sel, box] of [['#main-panel > #player', true], ['#main-panel > #md-np-info', false], ['#md-lyrics', false]]) {
      const el = document.querySelector(`ytmusic-player-page ${sel}`);
      if (el && el.offsetWidth) t.push({ el, box, transform: true });
    }
  }
  return t;
}
// Keyframe de partida: el sitio de antes (a) visto desde el nuevo (b). La carátula escala desde su
// centro (su transform-origin) y dentro de la escala de lyrics.css, de ahí el / s.
function guideFrom(t, a, b) {
  if (!t.transform) return a.left !== b.left ? { translate: `${a.left - b.left}px 0` } : null;
  const s = parseFloat(getComputedStyle(t.el).scale) || 1;
  if (!t.box) return { transform: `translate(${(a.left - b.left) / s}px, ${(a.top - b.top) / s}px)` };
  const dx = (a.left + a.width / 2 - b.left - b.width / 2) / s;
  const dy = (a.top + a.height / 2 - b.top - b.height / 2) / s;
  return { transform: `translate(${dx}px, ${dy}px) scale(${a.width / b.width})` };
}
let guidePassthrough = false;
let guideAnims = [];
function guideDone() {
  document.documentElement.removeAttribute('data-md-guide-closing');
  for (const a of guideAnims.splice(0)) a.cancel();
}
document.addEventListener('click', (e) => {
  const btn = !guidePassthrough && e.target instanceof Element && e.target.closest('ytmusic-nav-bar #guide-button');
  const app = document.querySelector('ytmusic-app');
  const g = document.querySelector('#guide-wrapper');
  // En ventanas estrechas YT usa su columna aparte (#mini-guide) y el menú flotante: se deja igual.
  if (!btn || !app || !g || window.innerWidth < 936 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  e.stopImmediatePropagation();
  guideDone(); // otro clic a mitad: lo anterior acaba en su sitio
  const root = document.documentElement;
  const was = app.hasAttribute('guide-collapsed');
  const timing = guideTiming();
  const from = guideWidth();
  const to = was ? guideOpenWidth() : GUIDE_MIN;
  // El panel se recorta con la forma de la tarjeta (#guide-wrapper::before), que no cambia al plegar:
  // solo se mueve su borde derecho, con las esquinas redondeadas todo el rato.
  const c = getComputedStyle(g, '::before');
  const bottom = parseFloat(c.top) + parseFloat(c.height);
  const rect = (w) => `rect(${c.top} ${w}px ${bottom}px ${c.left} round ${c.borderTopRightRadius})`;
  const targets = guideTargets();
  const first = targets.map((t) => t.el.getBoundingClientRect());
  // Al plegar, el panel sigue ancho por dentro hasta que el recorte llega a 72 px (theme.css).
  if (!was) root.setAttribute('data-md-guide-closing', '');
  const play = () => {
    // forwards: hasta que se quita, a la vez que se pliega de verdad (mismo fotograma).
    const clip = g.animate({ clipPath: [rect(from), rect(to)] }, { ...timing, fill: 'forwards' });
    guideAnims.push(clip);
    clip.finished.then(guideDone, () => {});
    if (!targets.length) return;
    // Now Playing: lyrics-view coloca ya la carátula y la letra en su sitio nuevo (su
    // ResizeObserver llegaría después de este cálculo) y se lee dónde quedaron.
    document.dispatchEvent(new Event('md-measure'));
    targets.forEach((t, i) => {
      const kf = guideFrom(t, first[i], t.el.getBoundingClientRect());
      if (!kf) return;
      const [prop, value] = Object.entries(kf)[0];
      guideAnims.push(t.el.animate({ [prop]: [value, prop === 'translate' ? '0 0' : 'none'] }, timing));
    });
  };
  // El cambio de YT se ve aquí antes de pintarse (las mutaciones se avisan en la misma tarea).
  const mo = new MutationObserver(() => {
    if (app.hasAttribute('guide-collapsed') === was) return;
    mo.disconnect();
    play();
  });
  mo.observe(app, { attributes: true, attributeFilter: ['guide-collapsed'] });
  // Al acabar este clic (antes de pintar): un click() dentro de otro click() programático sobre el
  // mismo botón no hace nada.
  queueMicrotask(() => {
    guidePassthrough = true;
    btn.click();
    guidePassthrough = false;
  });
  // Si YT no llega a cambiarlo, no se queda nada a medias.
  setTimeout(() => {
    mo.disconnect();
    if (app.hasAttribute('guide-collapsed') === was) root.removeAttribute('data-md-guide-closing');
  }, 500);
}, true);

// Espacio que ocupan los iconos de la derecha de la barra superior (transmitir, ajustes, avatar)
// más los botones de ventana, en --md-nav-right: theme.css coloca el buscador para no pisarlos.
// Se mide al cambiar el tamaño de la ventana o esos iconos (y en cada pasada de read()); solo se
// escribe si cambia.
let navRight = '';
function measureNavRight() {
  const icons = [...document.querySelectorAll('ytmusic-nav-bar #right-content > *')]
    .map((e) => e.getBoundingClientRect())
    .filter((r) => r.width > 2);
  if (!icons.length) return;
  const value = `${Math.ceil(window.innerWidth - Math.min(...icons.map((r) => r.left)) + 16)}px`;
  if (value !== navRight) {
    navRight = value;
    document.documentElement.style.setProperty('--md-nav-right', value);
  }
}
let navFrame = 0;
const scheduleNavRight = () => { if (!navFrame) navFrame = requestAnimationFrame(() => { navFrame = 0; measureNavRight(); }); };
window.addEventListener('resize', scheduleNavRight, { passive: true });
let navObserved = null;
function watchNavRight() {
  const rc = document.querySelector('ytmusic-nav-bar #right-content');
  if (rc && rc !== navObserved) {
    navObserved = rc;
    new ResizeObserver(scheduleNavRight).observe(rc);
  }
  measureNavRight();
}

// Títulos largos de álbum/playlist: se marcan para que theme.css los muestre más pequeños
// (como Spotify), en vez de dos líneas gigantes. Solo escribe si cambia.
function markLongTitle() {
  const t = document.querySelector('ytmusic-responsive-header-renderer > h1 .title');
  if (!t) return;
  const long = t.textContent.trim().length > 24;
  if (long !== t.hasAttribute('data-md-long')) t.toggleAttribute('data-md-long', long);
}

// Idioma de la página: se avisa a main.js solo cuando cambia (y no está vacío).
let lastLang = '';
function reportLang() {
  const code = document.documentElement.lang;
  if (code && code !== lastLang) {
    lastLang = code;
    ipcRenderer.send('lang', code);
  }
}

// Página abierta (para los Recientes del menú rápido): se avisa a main.js cuando cambia la URL.
let lastHref = '';
function reportOpened() {
  if (location.href === lastHref) return;
  lastHref = location.href;
  ipcRenderer.send('opened', location.href);
}

// Cola: al pasar de canción, la actual se desliza hasta arriba y las anteriores quedan ocultas
// encima. "Lock" hacia arriba: si al soltar el scroll la lista queda poco por encima de la actual
// (menos de QUEUE_LOCK px), vuelve sola a ella; más arriba se queda (se ven las anteriores) y al
// volver bajando se imanta en el mismo sitio. Hacia abajo no hace nada. scroll-snap nativo no
// sirve: imanta en los dos sentidos y no dejaba bajar un poco para ver las siguientes.
const QUEUE_LOCK = 160;
const QUEUE_GAP = 8; // aire sobre la canción actual
let queueScroller = null;
let queuePending = true; // alinear en cuanto se vea la cola (cambió la canción con Now Playing cerrado)
function queueAnchor(sc) {
  // La visible: YT marca también la versión oculta (canción/vídeo) de la misma entrada, de alto 0.
  const sel = [...sc.querySelectorAll('ytmusic-player-queue-item[selected]')].find((e) => e.offsetHeight);
  if (!sel) return null;
  // Debajo de los filtros, que quedan fijos arriba (theme.css).
  const chips = sc.querySelector('ytmusic-player-queue > #steering-chips');
  const top = chips ? chips.offsetHeight : 0;
  return Math.max(0, Math.round(sel.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - top - QUEUE_GAP));
}
function alignQueue() {
  const sc = queueScroller;
  if (!sc || !document.documentElement.hasAttribute('data-md-np-open') || !sc.offsetHeight) return;
  const a = queueAnchor(sc);
  if (a === null) return;
  queuePending = false;
  if (Math.abs(sc.scrollTop - a) > 1) sc.scrollTo({ top: a, behavior: 'smooth' });
}
let npObserver = null;
// Los filtros van pegados arriba (sticky, theme.css) y la lista pasa por debajo: se recorta en su
// borde inferior, así no se transparenta nada y la barra comparte el fondo de la tarjeta. Solo
// escribe cuando cambia (un clip-path en un elemento: no se hereda).
const queueClip = new WeakMap();
function clipQueue(sc) {
  const chips = sc.querySelector('ytmusic-player-queue > #steering-chips');
  const bottom = chips && chips.offsetHeight ? chips.getBoundingClientRect().bottom : null;
  for (const el of sc.querySelectorAll('ytmusic-player-queue > :is(#contents, #automix-contents)')) {
    const cut = bottom === null ? 0 : Math.max(0, Math.round(bottom - el.getBoundingClientRect().top));
    if (queueClip.get(el) === cut) continue;
    queueClip.set(el, cut);
    el.style.clipPath = cut ? `inset(${cut}px 0 0 0)` : '';
  }
}
function watchQueue() {
  // Al abrir Now Playing (lyrics-view.js marca data-md-np-open), si cambió la canción mientras
  // estaba cerrado. Aquí y no al cargar el preload: entonces <html> aún no existe.
  if (!npObserver) {
    npObserver = new MutationObserver(() => { if (queuePending) setTimeout(alignQueue, 150); });
    npObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-md-np-open'] });
  }
  const sc = document.querySelector('ytmusic-player-page #side-panel #tab-renderer');
  if (!sc || sc === queueScroller) return;
  queueScroller = sc;
  // scrollend llega también entre golpes de rueda seguidos: el lock espera 250 ms sin scroll (que
  // de verdad se haya soltado); si no, devolvía la lista tras el primer golpe y no dejaba subir.
  let lastScroll = 0;
  let lockTimer = 0;
  sc.addEventListener('scroll', () => { lastScroll = performance.now(); clipQueue(sc); }, { passive: true });
  clipQueue(sc);
  sc.addEventListener('scrollend', () => {
    clearTimeout(lockTimer);
    lockTimer = setTimeout(() => {
      if (performance.now() - lastScroll < 240) return;
      // Con la actual cerca del principio de la lista, subir del todo para ver las anteriores la
      // devolvía siempre: en el tope no actúa, y el lock nunca pasa de la mitad de lo que hay encima.
      const a = queueAnchor(sc);
      if (a !== null && sc.scrollTop > 0 && sc.scrollTop < a && a - sc.scrollTop < Math.min(QUEUE_LOCK, a / 2)) sc.scrollTo({ top: a, behavior: 'smooth' });
    }, 250);
  }, { passive: true });
  // Canción nueva: YT mueve el atributo selected; se alinea cuando YT termina de colocar la suya.
  new MutationObserver((ms) => {
    if (!ms.some((m) => m.target.hasAttribute && m.target.hasAttribute('selected'))) return;
    queuePending = true;
    setTimeout(alignQueue, 150);
  }).observe(sc, { attributes: true, attributeFilter: ['selected'], subtree: true });
  queuePending = true;
  alignQueue();
}

function read() {
  reportLang();
  reportOpened();
  ensureBackButton();
  ensureHomeButton();
  ensureGear();
  markLongTitle();
  applyCovers();
  updateResizers();
  watchNavRight();
  watchQueue();
  const bar = document.querySelector(MAIN_BAR);
  if (!bar) return;
  arrangeBar(bar);
  const title = (bar.querySelector('.title') || {}).textContent || '';
  // La línea de artista es "Artista • Álbum • Año": nos quedamos con el primer tramo.
  const byline = (bar.querySelector('.byline') || {}).textContent || '';
  const artist = byline.split('•')[0];
  const video = document.querySelector('video');
  if (video && video !== boundVideo) {
    boundVideo = video;
    video.addEventListener('timeupdate', syncTime, { passive: true });
    video.addEventListener('durationchange', syncTime, { passive: true });
    // Reproducir/pausa se avisa al momento (no en la siguiente pasada de un segundo): la bandeja
    // y los botones de la barra de tareas cambian de icono sin retraso.
    video.addEventListener('play', read, { passive: true });
    video.addEventListener('pause', read, { passive: true });
  }
  syncTime();
  const info = {
    title: title.trim(),
    artist: artist.trim(),
    playing: !!(video && !video.paused && !video.ended),
  };
  const key = JSON.stringify(info);
  if (key !== last) {
    last = key;
    ipcRenderer.send('track', info);
  }
  // YT pone las miniaturas a 60 px; en pantallas con escalado se ven borrosas. Las URL de
  // Google aceptan otro tamaño en el sufijo =wNN-hNN: la de la barra a 240 px y las de la cola
  // (que el tema muestra a 40 px) a 120. Las ya cambiadas dejan de coincidir con el selector.
  const img = bar.querySelector('.middle-controls img');
  if (img && /=w60-h60/.test(img.src)) img.src = img.src.replace(/=w60-h60/, '=w240-h240');
  for (const q of document.querySelectorAll('ytmusic-player-queue-item img[src*="=w60-h60"]')) {
    q.src = q.src.replace(/=w60-h60/, '=w120-h120');
  }
  // Carátula para el fondo difuminado del tema (theme.css usa --md-art).
  const art = img && img.src && !img.src.startsWith('data:') ? `url("${img.src}")` : 'none';
  if (art !== lastArt) {
    lastArt = art;
    document.documentElement.style.setProperty('--md-art', art);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  ensureHomeButton();
  setInterval(read, 1000);
});

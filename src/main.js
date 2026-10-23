const { app, BrowserWindow, Tray, Menu, Notification, dialog, globalShortcut, ipcMain, nativeImage, nativeTheme, screen, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pickLang, t, STRINGS } = require('./lib/i18n');
const { filterLibrary, pushRecent, recentItems, idFromUrl } = require('./lib/library');
const { matches, fromKeyEvent, validateAccelerator, displayAccelerator } = require('./lib/shortcut');
const { createCache } = require('./lib/cache');

const HOME = 'https://music.youtube.com/';
// Dominios que se abren dentro de la app (YouTube Music y el inicio de sesión de Google).
const INTERNAL_HOSTS = [/(^|\.)music\.youtube\.com$/, /(^|\.)accounts\.google\.[a-z.]+$/, /(^|\.)accounts\.youtube\.com$/, /(^|\.)consent\.youtube\.com$/, /(^|\.)google\.com$/];

// Google rechaza el inicio de sesión si el user agent dice "Electron": se usa el de Chrome a secas.
app.userAgentFallback = app.userAgentFallback
  .replace(/\s?Electron\/\S+/, '')
  .replace(new RegExp(`\\s?${app.getName()}\\/\\S+`), '');

// Rendimiento: rasterizado en GPU y subida de texturas sin copias extra.
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

// Solo desarrollo: permite inspeccionar la página por CDP (scripts/cdp.mjs).
if (process.env.YTM_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.YTM_DEBUG_PORT);
  // Que siga pintando aunque la ventana quede tapada, para poder medir FPS.
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const defaults = {
  bounds: { width: 1280, height: 820 }, maximized: false, notifications: true, closeToTray: true, theme: true, covers: {},
  lang: null, library: [], recent: [], suggested: [],
  panels: {}, // ancho elegido de la barra lateral y de la cola: { left?: px, right?: px }
  quickMenu: { accelerator: 'CommandOrControl+Shift+Space', reach: 'focused', fromOtherApps: 'float', shiftEnter: 'queue' },
};
let settings = { ...defaults };
try { settings = { ...defaults, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch {}
// quickMenu va anidado: las claves que falten en el archivo se completan con las de defaults.
settings.quickMenu = { ...defaults.quickMenu, ...settings.quickMenu };
if (!Array.isArray(settings.library)) settings.library = [];
if (!Array.isArray(settings.recent)) settings.recent = [];
if (!Array.isArray(settings.suggested)) settings.suggested = [];
function saveSettings() {
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch {}
}

// En Windows se usa el .ico (trae cada tamaño dibujado aparte); el .png queda de respaldo.
const iconCandidates = process.platform === 'win32' ? ['icon.ico', 'icon.png'] : ['icon.png'];
const iconPath = iconCandidates
  .map((f) => path.join(__dirname, '..', 'build', f))
  .find((f) => fs.existsSync(f));
const icon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();

let win = null;
let qmWin = null; // menú rápido (src/quickmenu), se crea la primera vez que se abre
let tray = null;
let quitting = false;
let track = { title: '', artist: '', playing: false };

// Idioma de la interfaz: el último detectado (settings.lang) o, la primera vez, el del sistema.
// Cuando la página informa del suyo (IPC 'lang') ese manda y se guarda.
let lang = pickLang(settings.lang || app.getLocale());
const stringsFor = (code) => STRINGS[code];
const sendStrings = (wc) => { if (wc && !wc.isDestroyed()) wc.send('strings', { lang, strings: stringsFor(lang) }); };

// Tema propio (src/theme.css), inyectado como hoja de estilos de usuario: sin JS en la página.
// chrome.css (barra superior arrastrable) va siempre, con o sin tema.
// Se leen en cada carga (son pequeños) para que F5 recoja los cambios al iterar.
// Antes de inyectar se quita siempre la versión anterior: tras una recarga puede seguir activa
// y, con !important de origen usuario, taparía los cambios nuevos.
// Las inyecciones van en cola (una tras otra) y se recuerdan todas las claves: si dos cargas
// llegan seguidas, ninguna clave se pierde y no se acumulan hojas viejas.
const readCss = (name) => fs.readFileSync(path.join(__dirname, name), 'utf8');
const injected = { theme: [], chrome: [] };
let injectQueue = Promise.resolve();
function inject(kind, css) {
  injectQueue = injectQueue.then(async () => {
    if (!win) return;
    const wc = win.webContents;
    for (const key of injected[kind].splice(0)) await wc.removeInsertedCSS(key).catch(() => {});
    if (css) injected[kind].push(await wc.insertCSS(css, { cssOrigin: 'user' }));
  }).catch(() => {});
  return injectQueue;
}
const applyTheme = () => inject('theme', settings.theme ? readCss('theme.css') : null);
const applyChrome = () => inject('chrome', readCss('chrome.css'));

function isInternal(url) {
  try { return INTERNAL_HOSTS.some((re) => re.test(new URL(url).hostname)); } catch { return false; }
}

function createWindow() {
  win = new BrowserWindow({
    ...settings.bounds,
    minWidth: 480,
    minHeight: 400,
    title: 'YouTube Music',
    icon,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    show: false,
    // Sin barra de título blanca: los botones de ventana se dibujan sobre la barra negra de la app.
    titleBarStyle: 'hidden',
    // Fondo transparente: los botones flotan sobre el fondo original de la página.
    // Alto = el de la barra superior de YT Music (64 px): así minimizar/maximizar/cerrar quedan
    // centrados en la misma línea que transmitir, ajustes y el avatar.
    titleBarOverlay: { color: '#00000000', symbolColor: '#ffffff', height: 64 },
    webPreferences: {
      partition: 'persist:ytmusic', // mantiene la sesión iniciada entre reinicios
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      // Chromium frena la página oculta para ahorrar CPU; el audio en reproducción está exento.
      backgroundThrottling: true,
    },
  });
  // Cada documento nuevo (cargas y recargas) recibe el tema; la navegación interna de YT Music no recarga.
  win.webContents.on('dom-ready', () => {
    pageApiReady = null; // documento nuevo: page-api.js se vuelve a ejecutar en la próxima llamada
    setRecording(false); // una recarga a mitad de grabación no deja los atajos globales apagados
    applyChrome();
    applyTheme();
    sendStrings(win.webContents);
    win.webContents.send('panels', settings.panels);
    // Portadas de la barra lateral: primero las guardadas (al instante) y luego las frescas.
    if (Object.keys(settings.covers).length) win.webContents.send('covers', settings.covers);
    setTimeout(refreshCovers, 4000);
    setTimeout(refreshLibrary, 4000);
    setTimeout(refreshSuggested, 4000);
  });
  win.setMenuBarVisibility(false);
  // Anclar a la barra de tareas: Windows ancla el programa que abrió la ventana. En la copia de
  // desarrollo ese programa es electron.exe (icono del átomo), así que se le indica a Windows
  // qué icono y qué comando usar al anclar. En la instalada apunta al propio .exe.
  if (process.platform === 'win32') {
    win.setAppDetails({
      appId: 'local.youtube-music-client',
      appIconPath: app.isPackaged ? process.execPath : iconPath,
      appIconIndex: 0,
      relaunchCommand: app.isPackaged ? `"${process.execPath}"` : `"${process.execPath}" "${app.getAppPath()}"`,
      relaunchDisplayName: 'Music Desktop',
    });
  }
  if (settings.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('show', () => updateThumbar(true));
  win.loadURL(HOME);

  // Enlaces externos → navegador del sistema.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternal(url)) { win.loadURL(url); } else { shell.openExternal(url); }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!isInternal(url)) { e.preventDefault(); shell.openExternal(url); }
  });

  // Atajos dentro de la ventana: el del menú rápido (modo "con la app enfocada"; en modo global
  // lo recibe globalShortcut), F5 recargar, Alt+←/→ historial, Ctrl +/-/0 zoom.
  // Mientras los ajustes graban un atajo, todas las teclas van a la página sin tocar.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || recording) return;
    const wc = win.webContents;
    if (matches(input, settings.quickMenu.accelerator)) { e.preventDefault(); if (!input.isAutoRepeat && !qmShortcutIsGlobal()) toggleQuickMenu(false); }
    else if (input.key === 'F5') { wc.reload(); e.preventDefault(); }
    else if (input.alt && input.key === 'ArrowLeft' && wc.navigationHistory.canGoBack()) { wc.navigationHistory.goBack(); e.preventDefault(); }
    else if (input.alt && input.key === 'ArrowRight' && wc.navigationHistory.canGoForward()) { wc.navigationHistory.goForward(); e.preventDefault(); }
    else if (input.control && (input.key === '=' || input.key === '+')) { wc.setZoomLevel(wc.getZoomLevel() + 0.5); e.preventDefault(); }
    else if (input.control && input.key === '-') { wc.setZoomLevel(wc.getZoomLevel() - 0.5); e.preventDefault(); }
    else if (input.control && input.key === '0') { wc.setZoomLevel(0); e.preventDefault(); }
  });

  const rememberBounds = () => {
    if (!win.isMaximized() && !win.isMinimized()) settings.bounds = win.getBounds();
    settings.maximized = win.isMaximized();
  };
  win.on('resize', rememberBounds);
  win.on('move', rememberBounds);
  // Si la ventana pierde el foco a mitad de grabación, los atajos globales vuelven al momento.
  win.on('blur', () => setRecording(false));

  win.on('close', (e) => {
    saveSettings();
    if (!quitting && settings.closeToTray) { e.preventDefault(); win.hide(); }
  });
  // El menú rápido oculto también cuenta como ventana: sin cerrarlo, la app no saldría al cerrar esta.
  win.on('closed', () => { win = null; if (qmWin) qmWin.destroy(); });
}

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// Acciones del reproductor, ejecutadas sobre la página de YouTube Music.
const PLAYER_JS = {
  // La barra visible es la del slot "player-bar" (YT a veces crea otra oculta).
  playPause: `(() => { const b = document.querySelector('ytmusic-player-bar[slot="player-bar"] #play-pause-button'); if (b) b.click(); else { const v = document.querySelector('video'); if (v) v.paused ? v.play() : v.pause(); } })()`,
  next: `document.querySelector('ytmusic-player-bar[slot="player-bar"] .next-button')?.click()`,
  previous: `document.querySelector('ytmusic-player-bar[slot="player-bar"] .previous-button')?.click()`,
  like: `document.querySelector('ytmusic-player-bar[slot="player-bar"] yt-button-shape.like button')?.click()`,
};
function player(action) {
  if (win) win.webContents.executeJavaScript(PLAYER_JS[action]).catch(() => {});
}

// Botones en la vista previa de la barra de tareas de Windows (al pasar el ratón por el icono):
// anterior, reproducir/pausa y siguiente, como Spotify. Windows los olvida cuando la ventana se
// oculta, así que se vuelven a poner al mostrarla; si no, solo cuando cambia reproducir/pausa.
const thumbImg = (name) => nativeImage.createFromPath(path.join(__dirname, '..', 'build', `thumb-${name}.png`));
const THUMB = process.platform === 'win32'
  ? { prev: thumbImg('prev'), play: thumbImg('play'), pause: thumbImg('pause'), next: thumbImg('next') }
  : null;
let thumbPlaying = null;
function updateThumbar(force) {
  if (!THUMB || !win || win.isDestroyed() || THUMB.play.isEmpty()) return;
  if (!force && thumbPlaying === track.playing) return;
  thumbPlaying = track.playing;
  win.setThumbarButtons([
    { tooltip: t(lang, 'tray.previous'), icon: THUMB.prev, click: () => player('previous') },
    // El icono cambia al instante (sin esperar a que la página confirme); si algo falla, la
    // página manda el estado real enseguida (preload.js avisa en 'play'/'pause' del vídeo).
    { tooltip: t(lang, track.playing ? 'tray.pause' : 'tray.play'), icon: track.playing ? THUMB.pause : THUMB.play, click: () => { player('playPause'); track.playing = !track.playing; refreshUi(); } },
    { tooltip: t(lang, 'tray.next'), icon: THUMB.next, click: () => player('next') },
  ]);
}

function trackLabel() {
  return track.title ? `${track.title}${track.artist ? ' — ' + track.artist : ''}` : 'YouTube Music';
}

// Interruptores de los ajustes: los comparten la bandeja y el menú del engranaje.
const SWITCHES = {
  theme: { get: () => settings.theme, set: (v) => { settings.theme = v; saveSettings(); applyTheme(); } },
  notifications: { get: () => settings.notifications, set: (v) => { settings.notifications = v; saveSettings(); } },
  closeToTray: { get: () => settings.closeToTray, set: (v) => { settings.closeToTray = v; saveSettings(); } },
  startWithWindows: {
    get: () => app.getLoginItemSettings().openAtLogin,
    set: (v) => app.setLoginItemSettings({ openAtLogin: v, args: ['--hidden'] }),
  },
};
const SWITCH_LABELS = [['theme', 'set.theme'], ['notifications', 'set.notify'], ['closeToTray', 'set.closeToTray'], ['startWithWindows', 'set.startWithWindows']];
// Cambia un interruptor y rehace la bandeja para que sus casillas muestren lo mismo.
function changeSwitch(key, value) {
  if (SWITCHES[key].get() !== value) SWITCHES[key].set(value);
  refreshUi();
}

// Lo que ve el menú del engranaje (IPC 'settings:get' / 'settings:set' / 'settings:changed').
function settingsView() {
  const view = Object.fromEntries(Object.entries(SWITCHES).map(([k, s]) => [k, s.get()]));
  return { ...view, quickMenu: { ...settings.quickMenu }, display: { shortcut: displayAccelerator(settings.quickMenu.accelerator) } };
}
// Avisa a la página de un cambio hecho desde la bandeja (si el menú está abierto, se redibuja).
function notifySettings() {
  if (win && !win.isDestroyed()) win.webContents.send('settings:changed', settingsView());
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: trackLabel(), enabled: false },
    { type: 'separator' },
    ...(updateReady ? [{ label: t(lang, 'upd.tray', { version: updateReady }), click: installUpdate }, { type: 'separator' }] : []),
    { label: t(lang, track.playing ? 'tray.pause' : 'tray.play'), click: () => player('playPause') },
    { label: t(lang, 'tray.next'), click: () => player('next') },
    { label: t(lang, 'tray.previous'), click: () => player('previous') },
    { type: 'separator' },
    { label: t(lang, 'tray.show'), click: showWindow },
    ...SWITCH_LABELS.map(([key, label]) => ({
      label: t(lang, label), type: 'checkbox', checked: SWITCHES[key].get(),
      click: (item) => { changeSwitch(key, item.checked); notifySettings(); },
    })),
    { type: 'separator' },
    { label: t(lang, 'tray.quit'), click: () => { quitting = true; app.quit(); } },
  ]);
}

function refreshUi() {
  const label = trackLabel();
  if (tray) {
    tray.setToolTip(label.length > 127 ? label.slice(0, 124) + '…' : label);
    tray.setContextMenu(buildTrayMenu());
  }
  if (win) win.setTitle(track.title ? `${label} · YouTube Music` : 'YouTube Music');
  updateThumbar(false);
  if (qmWin && !qmWin.isDestroyed()) qmWin.webContents.send('qm:track', track);
}

function createTray() {
  // Sin redimensionar: con el .ico Windows elige el tamaño exacto según el escalado de pantalla.
  tray = new Tray(icon);
  tray.on('click', () => (win && win.isVisible() && win.isFocused() ? win.hide() : showWindow()));
  tray.on('double-click', showWindow);
  refreshUi();
}

// API dentro de la página (src/page-api.js): instala window.__md, con la sesión de YT Music.
// Se ejecuta una vez por documento (dom-ready pone pageApiReady a null). pageApi(call, ...args)
// llama a window.__md[call] y nunca rechaza: ante cualquier fallo resuelve { error }.
const pageApiJs = fs.readFileSync(path.join(__dirname, 'page-api.js'), 'utf8');
const PAGE_API_CALLS = new Set(['library', 'searchSongs', 'suggestions', 'play', 'queue', 'open']);
const PAGE_API_TIMEOUT = 20000;
let pageApiReady = null;
function onYouTubeMusic() {
  try { return new URL(win.webContents.getURL()).hostname === 'music.youtube.com'; } catch { return false; }
}
function ensurePageApi() {
  if (!pageApiReady) {
    const ready = win.webContents.executeJavaScript(pageApiJs, true);
    pageApiReady = ready;
    ready.catch(() => { if (pageApiReady === ready) pageApiReady = null; });
  }
  return pageApiReady;
}
async function pageApi(call, ...args) {
  let timer;
  try {
    if (!win || win.isDestroyed()) return { error: 'sin ventana' };
    if (!PAGE_API_CALLS.has(call)) return { error: 'llamada desconocida: ' + call };
    // En la página de inicio de sesión de Google (u otra) no hay nada que llamar.
    if (!onYouTubeMusic()) return { error: 'fuera de YouTube Music' };
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ error: 'tiempo agotado' }), PAGE_API_TIMEOUT); });
    const run = async () => {
      await ensurePageApi();
      // Si el documento cambió entre medias y __md no está, se reinstala y se reintenta una vez.
      const expr = `window.__md ? window.__md.${call}(...${JSON.stringify(args)}) : { mdMissing: true }`;
      let res = await win.webContents.executeJavaScript(expr, true);
      if (res && res.mdMissing) {
        pageApiReady = null;
        await ensurePageApi();
        res = await win.webContents.executeJavaScript(expr, true);
      }
      return res && typeof res === 'object' && !res.mdMissing ? res : { error: 'sin respuesta' };
    };
    return await Promise.race([run(), timeout]);
  } catch (e) {
    return { error: String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

// Biblioteca (playlists y álbumes) para el menú rápido; se guarda para tenerla sin conexión.
async function refreshLibrary() {
  const res = await pageApi('library');
  if (!res || !Array.isArray(res.items) || !res.items.length) return;
  settings.library = res.items;
  saveSettings();
}
setInterval(refreshLibrary, 15 * 60 * 1000);

// Canciones sugeridas del inicio de YT Music, para el menú rápido sin escribir nada. También se guardan.
async function refreshSuggested() {
  const res = await pageApi('suggestions');
  if (!res || !Array.isArray(res.songs) || !res.songs.length) return;
  settings.suggested = res.songs;
  saveSettings();
}
setInterval(refreshSuggested, 15 * 60 * 1000);

// Recientes: ids de la biblioteca abiertos hace poco (desde el menú o navegando por la página).
// Solo se guarda si cambia algo.
function recordRecent(id) {
  const next = pushRecent(settings.recent, id, new Set(settings.library.map((i) => i.id)));
  if (next.length === settings.recent.length && next.every((r, i) => r === settings.recent[i])) return;
  settings.recent = next;
  saveSettings();
}

// preload.js avisa cada vez que cambia la URL de la página. Los álbumes se abren como
// /playlist?list=OLAK5uy_… ('VLOLAK…'): se traducen a su id de la biblioteca ('MPREb_…').
ipcMain.on('opened', (e, url) => {
  if (!win || e.sender !== win.webContents) return;
  const id = idFromUrl(url);
  if (!id) return;
  const album = settings.library.find((i) => i.type === 'album' && i.playlistId && 'VL' + i.playlistId === id);
  recordRecent(album ? album.id : id);
});

// --- Menú rápido (src/quickmenu) ---
// Ventana sin marco y transparente: el panel (540 px) dibuja su propia sombra en el margen
// (quickmenu.css: body con padding 60 arriba, sitio para el aviso, y 24 a los lados). Se crea una vez y se reutiliza.
const QM_SIZE = { width: 588, height: 700 };
let qmLoaded = null;
function createQuickMenu() {
  qmWin = new BrowserWindow({
    ...QM_SIZE,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: 'Music Desktop',
    icon,
    webPreferences: {
      preload: path.join(__dirname, 'quickmenu', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  qmWin.setMenuBarVisibility(false);
  qmLoaded = new Promise((resolve) => qmWin.webContents.once('did-finish-load', resolve));
  qmWin.loadFile(path.join(__dirname, 'quickmenu', 'quickmenu.html'));
  qmWin.on('blur', hideQuickMenu);
  // Con el menú abierto el foco está aquí: el mismo atajo lo cierra.
  qmWin.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && matches(input, settings.quickMenu.accelerator)) {
      e.preventDefault();
      if (!input.isAutoRepeat && !qmShortcutIsGlobal()) hideQuickMenu();
    }
  });
  // Nada de navegar ni abrir ventanas desde el menú.
  qmWin.webContents.on('will-navigate', (e) => e.preventDefault());
  qmWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  qmWin.on('closed', () => { qmWin = null; qmLoaded = null; });
}

// Centrado en la pantalla de la app si tiene el foco; si no, en la del ratón (Electron no sabe en
// qué pantalla está la ventana enfocada de otro programa).
function placeQuickMenu(overWin) {
  const { width, height } = QM_SIZE;
  const display = overWin ? screen.getDisplayMatching(win.getBounds()) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const a = display.workArea;
  const bounds = { x: a.x + Math.round((a.width - width) / 2), y: a.y + Math.max(0, Math.round((a.height - height) / 2)), width, height };
  qmWin.setBounds(bounds);
  // Windows: al saltar a una pantalla con otro escalado, el primer setBounds deja mal el tamaño.
  qmWin.setBounds(bounds);
}

let qmOpening = false;
async function showQuickMenu(fromOutside) {
  if (qmOpening) return;
  qmOpening = true;
  try {
    let overWin = !!(win && win.isVisible() && win.isFocused());
    if (fromOutside && settings.quickMenu.fromOtherApps === 'front') {
      showWindow();
      overWin = true;
    }
    if (!qmWin) createQuickMenu();
    await qmLoaded;
    if (!qmWin) return;
    // Primero el contenido (el menú se reinicia con cada qm:show) y luego se muestra.
    qmWin.webContents.send('qm:show', {
      strings: stringsFor(lang),
      recent: recentItems(settings.recent, settings.library),
      suggested: settings.suggested,
      track,
      shiftEnter: settings.quickMenu.shiftEnter,
    });
    placeQuickMenu(overWin && !!win);
    qmWin.show();
    qmWin.focus();
  } finally {
    qmOpening = false;
  }
}

function hideQuickMenu() {
  clearTimeout(songsTimer);
  if (qmWin && qmWin.isVisible()) qmWin.hide();
}

function toggleQuickMenu(fromOutside) {
  if (qmWin && qmWin.isVisible()) hideQuickMenu();
  else showQuickMenu(fromOutside);
}

const fromQuickMenu = (e) => !!qmWin && e.sender === qmWin.webContents;

// Búsqueda: la biblioteca responde al momento; las canciones, 200 ms después de la última
// tecla, por 'qm:songs'. Las respuestas llevan el seq de su consulta (el menú descarta las viejas).
// Las búsquedas ya hechas salen de la caché en la propia respuesta, sin esperar.
const songsCache = createCache(100, 10 * 60 * 1000);
let songsTimer = null;
let songsSeq = 0;
ipcMain.handle('qm:query', (e, msg) => {
  if (!fromQuickMenu(e)) return null;
  const seq = msg && msg.seq;
  const text = msg && typeof msg.text === 'string' ? msg.text.slice(0, 200) : '';
  const key = text.trim().toLowerCase().replace(/\s+/g, ' ');
  const cached = key ? songsCache.get(key) : undefined;
  songsSeq = seq;
  clearTimeout(songsTimer);
  if (key && !cached) {
    const sender = e.sender;
    songsTimer = setTimeout(async () => {
      const res = await pageApi('searchSongs', text);
      if (Array.isArray(res.songs)) songsCache.set(key, res.songs);
      if (seq !== songsSeq || sender.isDestroyed()) return; // ya hay una consulta más nueva
      sender.send('qm:songs', { seq, songs: Array.isArray(res.songs) ? res.songs : [] });
    }, 200);
  }
  return { seq, library: filterLibrary(settings.library, text), songs: cached || null };
});

// Intro: canción → suena (sustituye la cola, como en la búsqueda de YT); playlist o álbum → se abre
// su página sin tocar la reproducción. Mayús + Intro en una canción: a la cola o a continuación,
// y el menú sigue abierto con un aviso. El menú no se cierra solo: lo cierra main.
ipcMain.handle('qm:activate', async (e, msg) => {
  if (!fromQuickMenu(e)) return { keepOpen: true };
  const item = (msg && msg.item) || {};
  const shift = !!(msg && msg.shift);
  if (typeof item.id !== 'string' || !item.id) return { keepOpen: true };
  if (item.kind === 'song') {
    if (shift) {
      const next = settings.quickMenu.shiftEnter === 'next';
      const res = await pageApi('queue', item.id, next ? 'next' : 'end');
      return { keepOpen: true, note: !(res && res.ok) ? 'failed' : next ? 'playingNext' : 'added' };
    }
    pageApi('play', item.id);
    hideQuickMenu();
    return { keepOpen: false };
  }
  if (item.kind === 'playlist' || item.kind === 'album') {
    if (shift) return { keepOpen: true }; // Mayús + Intro solo vale para canciones
    const id = item.id;
    hideQuickMenu();
    showWindow(); // oculta, minimizada o detrás de otra ventana: la página abierta tiene que verse
    pageApi('open', id).then((res) => { if (res && res.ok) recordRecent(id); });
    return { keepOpen: false };
  }
  return { keepOpen: true };
});

ipcMain.on('qm:close', (e) => { if (fromQuickMenu(e)) hideQuickMenu(); });

// Anterior / reproducir-pausa / siguiente desde el menú. Como en la barra de tareas, el icono
// cambia al momento y la página confirma el estado real enseguida.
ipcMain.on('qm:player', (e, action) => {
  if (!fromQuickMenu(e) || !['previous', 'playPause', 'next'].includes(action)) return;
  player(action);
  if (action === 'playPause') { track.playing = !track.playing; refreshUi(); }
});

// Portadas de las playlists de la barra lateral (como Spotify). covers.js corre dentro de la
// página, con su sesión, y devuelve { browseId: url }; se guarda y se pasa a preload.js.
// Usa window.__md.browse, así que antes se asegura page-api.js.
const coversJs = fs.readFileSync(path.join(__dirname, 'covers.js'), 'utf8');
async function refreshCovers() {
  if (!win || !onYouTubeMusic()) return;
  try {
    await ensurePageApi();
    const res = await win.webContents.executeJavaScript(coversJs, true);
    if (!res || !res.covers || !Object.keys(res.covers).length) return;
    settings.covers = res.covers;
    saveSettings();
    win.webContents.send('covers', res.covers);
  } catch {}
}
setInterval(refreshCovers, 15 * 60 * 1000);

ipcMain.on('track', (_e, info) => {
  const changed = info.title && (info.title !== track.title || info.artist !== track.artist);
  track = { title: info.title || '', artist: info.artist || '', playing: !!info.playing };
  refreshUi();
  if (changed && info.playing && settings.notifications && Notification.isSupported() && !(win && win.isFocused())) {
    new Notification({ title: track.title, body: track.artist, icon, silent: true }).show();
  }
});

// Anchos de los paneles laterales elegidos arrastrando su borde (preload.js). Se guardan solo
// números dentro de los límites; un lado sin valor vuelve al ancho por defecto.
const PANEL_LIMITS = { left: [240, 420], right: [280, 480] };
ipcMain.on('panels', (e, w) => {
  if (!win || e.sender !== win.webContents || !w || typeof w !== 'object') return;
  const next = {};
  for (const [side, [min, max]] of Object.entries(PANEL_LIMITS)) {
    if (Number.isFinite(w[side])) next[side] = Math.round(Math.min(max, Math.max(min, w[side])));
  }
  settings.panels = next;
  saveSettings();
});

// La página (preload.js) informa de su idioma; si cambia, se guarda y se rehace la bandeja.
// Siempre se responde con los textos, también al arrancar, para que el botón "atrás" los tenga.
ipcMain.on('lang', (e, code) => {
  if (code) {
    const next = pickLang(code);
    const changed = next !== lang;
    lang = next;
    if (settings.lang !== lang) { settings.lang = lang; saveSettings(); }
    if (changed) refreshUi();
  }
  sendStrings(e.sender);
});

// --- Atajos globales ---
// Anterior, siguiente y mostrar/ocultar, y el del menú rápido solo en modo "en cualquier lugar".
// Play/pausa no tiene: chocaba con el del menú rápido; va por Alt+↓ en el menú o la tecla multimedia.
// Nunca se usa unregisterAll: cada atajo se quita por su nombre.
const PLAYER_SHORTCUTS = {
  'CommandOrControl+Alt+Right': () => player('next'),
  'CommandOrControl+Alt+Left': () => player('previous'),
  'CommandOrControl+Alt+M': () => (win && win.isVisible() ? win.hide() : showWindow()),
};
function registerPlayerShortcuts() {
  for (const [acc, fn] of Object.entries(PLAYER_SHORTCUTS)) {
    if (!globalShortcut.isRegistered(acc)) globalShortcut.register(acc, fn);
  }
}
function unregisterPlayerShortcuts() {
  for (const acc of Object.keys(PLAYER_SHORTCUTS)) globalShortcut.unregister(acc);
}

let qmGlobalAcc = null; // acelerador global registrado ahora para el menú rápido (o null)
const qmShortcutIsGlobal = () => qmGlobalAcc !== null && qmGlobalAcc === settings.quickMenu.accelerator;
const onQuickMenuShortcut = () => toggleQuickMenu(!win || !win.isFocused());
function registerQuickMenuGlobal(acc) {
  try { return globalShortcut.register(acc, onQuickMenuShortcut); } catch { return false; }
}

// Aplica (y solo si todo va bien, guarda) los ajustes del menú rápido. Quita siempre el atajo
// global anterior; en modo 'global' registra el nuevo y, si otro programa ya lo tiene, vuelve a
// registrar el anterior y responde 'taken'. En modo 'focused' lo atiende before-input-event.
function applyQuickMenuShortcut(next) {
  const check = validateAccelerator(next.accelerator);
  if (!check.ok) return check.reason;
  const prev = qmGlobalAcc;
  if (prev) globalShortcut.unregister(prev);
  qmGlobalAcc = null;
  if (next.reach === 'global') {
    if (!registerQuickMenuGlobal(next.accelerator)) {
      if (prev && registerQuickMenuGlobal(prev)) qmGlobalAcc = prev;
      return 'taken';
    }
    qmGlobalAcc = next.accelerator;
  }
  settings.quickMenu = { ...next };
  saveSettings();
  return 'ok';
}

// Grabación de un atajo en los ajustes: mientras dura, ningún atajo propio (globales ni de la
// ventana) se come las teclas, para que la página reciba la combinación tal cual. Al terminar
// (o si la ventana pierde el foco o se recarga) vuelven todos.
let recording = false;
function setRecording(on) {
  if (on === recording) return;
  recording = on;
  if (on) {
    unregisterPlayerShortcuts();
    if (qmGlobalAcc) globalShortcut.unregister(qmGlobalAcc);
  } else {
    registerPlayerShortcuts();
    if (qmGlobalAcc && !registerQuickMenuGlobal(qmGlobalAcc)) qmGlobalAcc = null;
  }
}

const fromMainPage = (e) => !!win && e.sender === win.webContents;
ipcMain.on('settings:recording', (e, on) => { if (fromMainPage(e)) setRecording(!!on); });
ipcMain.handle('settings:get', (e) => (fromMainPage(e) ? settingsView() : null));
// Pulsación grabada → acelerador ('CommandOrControl+Shift+K'), o null si solo hay modificadores.
// La conversión vive en src/lib/shortcut.js, que el preload (sandbox) no puede cargar.
ipcMain.handle('settings:key', (e, ev) => {
  if (!fromMainPage(e) || !ev || typeof ev !== 'object') return null;
  return fromKeyEvent({
    key: String(ev.key ?? ''), code: String(ev.code ?? ''),
    ctrlKey: !!ev.ctrlKey, altKey: !!ev.altKey, shiftKey: !!ev.shiftKey, metaKey: !!ev.metaKey,
  });
});
// patch: { theme?, notifications?, closeToTray?, startWithWindows?, quickMenu?: { accelerator?,
// reach?, fromOtherApps?, shiftEnter? } }. Responde settingsView() o { error } si el atajo no vale.
const QM_CHOICES = { reach: ['focused', 'global'], fromOtherApps: ['float', 'front'], shiftEnter: ['queue', 'next'] };
ipcMain.handle('settings:set', (e, patch) => {
  if (!fromMainPage(e) || !patch || typeof patch !== 'object') return null;
  const q = patch.quickMenu;
  if (q && typeof q === 'object') {
    const next = { ...settings.quickMenu };
    if (typeof q.accelerator === 'string') next.accelerator = q.accelerator;
    for (const [k, allowed] of Object.entries(QM_CHOICES)) if (allowed.includes(q[k])) next[k] = q[k];
    if (next.accelerator !== settings.quickMenu.accelerator || next.reach !== settings.quickMenu.reach) {
      const res = applyQuickMenuShortcut(next);
      if (res !== 'ok') return { error: res };
    } else {
      settings.quickMenu = next;
      saveSettings();
    }
  }
  for (const key of Object.keys(SWITCHES)) if (typeof patch[key] === 'boolean') changeSwitch(key, patch[key]);
  refreshUi();
  return settingsView();
});

// --- Actualizaciones automáticas ---
// En cada arranque se mira en los releases de GitHub (repo público, sin token) si hay una versión
// más nueva; se descarga en segundo plano y se ofrece reiniciar. Si se deja para luego, se instala
// al salir. Solo en la app instalada: la portable no tiene instalador que sustituir y la copia de
// desarrollo no está empaquetada. Sin conexión no se avisa de nada: se reintenta al próximo arranque.
let updater = null;
let updateReady = null; // versión descargada y lista para instalar
function updateLog(level, msg) {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'updater.log'), `${new Date().toISOString()} ${level} ${msg}\n`); } catch {}
}
function installUpdate() {
  if (!updater || !updateReady) return;
  quitting = true; // si no, "cerrar a la bandeja" esconde la ventana en vez de dejar salir
  updater.quitAndInstall();
}
async function askToRestart() {
  const parent = win && win.isVisible() ? win : undefined;
  const { response } = await dialog.showMessageBox(parent, {
    type: 'info',
    title: t(lang, 'upd.title'),
    message: t(lang, 'upd.title'),
    detail: t(lang, 'upd.body', { version: updateReady }),
    buttons: [t(lang, 'upd.restart'), t(lang, 'upd.later')],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response === 0) installUpdate();
}
function setupUpdates() {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return;
  try { updater = require('electron-updater').autoUpdater; } catch { return; }
  const log = (level) => (m) => updateLog(level, String(m));
  updater.logger = { info: log('info'), warn: log('warn'), error: log('error'), debug: () => {} };
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on('update-downloaded', (info) => {
    updateReady = info.version;
    refreshUi();
    askToRestart();
  });
  updater.on('error', (e) => updateLog('error', (e && e.message) || e));
  updater.checkForUpdates().catch(() => {});
}

app.on('second-instance', showWindow);
app.on('before-quit', () => { quitting = true; saveSettings(); });
app.on('will-quit', () => globalShortcut.unregisterAll());

app.whenReady().then(() => {
  // Solo instalada: el instalador crea el acceso directo con este ID y su icono. Sin acceso
  // directo (copia de desarrollo) Windows mostraría el icono de electron.exe, el átomo.
  if (app.isPackaged) app.setAppUserModelId('local.youtube-music-client');
  nativeTheme.themeSource = 'dark'; // menús, barras de scroll y diálogos oscuros
  createWindow();
  if (process.argv.includes('--hidden')) win.once('ready-to-show', () => win.hide());
  createTray();

  // Atajos globales (las teclas multimedia del teclado ya funcionan solas vía Windows).
  registerPlayerShortcuts();
  applyQuickMenuShortcut(settings.quickMenu);
  setupUpdates();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !settings.closeToTray) app.quit();
});

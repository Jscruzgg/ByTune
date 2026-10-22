const { app, BrowserWindow, Tray, Menu, Notification, globalShortcut, ipcMain, nativeImage, nativeTheme, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

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
const defaults = { bounds: { width: 1280, height: 820 }, maximized: false, notifications: true, closeToTray: true, theme: true, covers: {} };
let settings = { ...defaults };
try { settings = { ...defaults, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch {}
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
let tray = null;
let quitting = false;
let track = { title: '', artist: '', playing: false };

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
    titleBarOverlay: { color: '#00000000', symbolColor: '#ffffff', height: 40 },
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
    applyChrome();
    applyTheme();
    // Portadas de la barra lateral: primero las guardadas (al instante) y luego las frescas.
    if (Object.keys(settings.covers).length) win.webContents.send('covers', settings.covers);
    setTimeout(refreshCovers, 4000);
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
  win.loadURL(HOME);

  // Enlaces externos → navegador del sistema.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternal(url)) { win.loadURL(url); } else { shell.openExternal(url); }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!isInternal(url)) { e.preventDefault(); shell.openExternal(url); }
  });

  // Atajos dentro de la ventana: F5 recargar, Alt+←/→ historial, Ctrl +/-/0 zoom.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const wc = win.webContents;
    if (input.key === 'F5') { wc.reload(); e.preventDefault(); }
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

  win.on('close', (e) => {
    saveSettings();
    if (!quitting && settings.closeToTray) { e.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { win = null; });
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

function trackLabel() {
  return track.title ? `${track.title}${track.artist ? ' — ' + track.artist : ''}` : 'YouTube Music';
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: trackLabel(), enabled: false },
    { type: 'separator' },
    { label: track.playing ? 'Pausar' : 'Reproducir', click: () => player('playPause') },
    { label: 'Siguiente', click: () => player('next') },
    { label: 'Anterior', click: () => player('previous') },
    { type: 'separator' },
    { label: 'Mostrar ventana', click: showWindow },
    {
      label: 'Tema Music Desktop', type: 'checkbox', checked: settings.theme,
      click: (item) => { settings.theme = item.checked; saveSettings(); applyTheme(); },
    },
    {
      label: 'Notificar cambio de canción', type: 'checkbox', checked: settings.notifications,
      click: (item) => { settings.notifications = item.checked; saveSettings(); },
    },
    {
      label: 'Cerrar a la bandeja', type: 'checkbox', checked: settings.closeToTray,
      click: (item) => { settings.closeToTray = item.checked; saveSettings(); },
    },
    {
      label: 'Iniciar con Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }),
    },
    { type: 'separator' },
    { label: 'Salir', click: () => { quitting = true; app.quit(); } },
  ]);
}

function refreshUi() {
  const label = trackLabel();
  if (tray) {
    tray.setToolTip(label.length > 127 ? label.slice(0, 124) + '…' : label);
    tray.setContextMenu(buildTrayMenu());
  }
  if (win) win.setTitle(track.title ? `${label} · YouTube Music` : 'YouTube Music');
}

function createTray() {
  // Sin redimensionar: con el .ico Windows elige el tamaño exacto según el escalado de pantalla.
  tray = new Tray(icon);
  tray.on('click', () => (win && win.isVisible() && win.isFocused() ? win.hide() : showWindow()));
  tray.on('double-click', showWindow);
  refreshUi();
}

// Portadas de las playlists de la barra lateral (como Spotify). covers.js corre dentro de la
// página, con su sesión, y devuelve { browseId: url }; se guarda y se pasa a preload.js.
const coversJs = fs.readFileSync(path.join(__dirname, 'covers.js'), 'utf8');
async function refreshCovers() {
  if (!win) return;
  try {
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
  globalShortcut.register('CommandOrControl+Alt+Space', () => player('playPause'));
  globalShortcut.register('CommandOrControl+Alt+Right', () => player('next'));
  globalShortcut.register('CommandOrControl+Alt+Left', () => player('previous'));
  globalShortcut.register('CommandOrControl+Alt+M', () => (win && win.isVisible() ? win.hide() : showWindow()));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !settings.closeToTray) app.quit();
});

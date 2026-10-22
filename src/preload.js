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
function labelBack(btn) {
  const text = strings['nav.back'];
  if (!text) return;
  if (btn.title !== text) btn.title = text;
  if (btn.getAttribute('aria-label') !== text) btn.setAttribute('aria-label', text);
}
ipcRenderer.on('strings', (_e, msg) => {
  strings = (msg && msg.strings) || {};
  const btn = document.querySelector('ytmusic-nav-bar > .md-back');
  if (btn) labelBack(btn);
});
// Botón "atrás" en la barra superior (YT Music no trae uno). YT navega con el historial del
// navegador, así que basta con history.back(); se desactiva cuando no hay a dónde volver.
function updateBack(btn) {
  const can = window.navigation ? window.navigation.canGoBack : history.length > 1;
  if (btn.disabled === can) btn.disabled = !can;
}
function ensureBackButton() {
  const nav = document.querySelector('ytmusic-nav-bar');
  if (!nav) return;
  let btn = nav.querySelector(':scope > .md-back');
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'md-back';
    btn.addEventListener('click', () => history.back());
    nav.appendChild(btn);
    if (window.navigation) window.navigation.addEventListener('currententrychange', () => updateBack(btn));
  }
  labelBack(btn);
  updateBack(btn);
}

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

function read() {
  reportLang();
  ensureBackButton();
  markLongTitle();
  applyCovers();
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
  // Título y artista grandes bajo la carátula en Now Playing (theme.css los pinta con attr()).
  // Se comprueba en cada pasada porque el panel puede crearse después del cambio de canción.
  const panel = document.querySelector('ytmusic-player-page #main-panel');
  if (panel && panel.getAttribute('data-md-title') !== info.title) {
    panel.setAttribute('data-md-title', info.title);
    panel.setAttribute('data-md-artist', info.artist);
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
  setInterval(read, 1000);
});

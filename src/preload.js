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

function read() {
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

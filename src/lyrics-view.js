// Letras en Now Playing (mundo principal de la página). main.js antepone lib/lyrics-timing.js
// (mdLyricsTiming) y lo ejecuta en cada carga dentro de un bloque { }; luego llama a init.
// Habla con main.js por preload.js: deja el mensaje en <html data-md-lyrics-msg> y lanza 'md-lyrics'.
// Dibuja su propia fila de título bajo la carátula (#md-np-info, con el botón de letras) y el área
// de letras (#md-lyrics). El estado va en atributos de ytmusic-player-page y el CSS (lyrics.css)
// hace todo el movimiento. YouTube Music impone Trusted Types: nada de innerHTML.
// Sin bucles: todo va por eventos del <video>, del reproductor y de la barra.
if (window.__mdLyrics && window.__mdLyrics.destroy) window.__mdLyrics.destroy();
window.__mdLyrics = (() => {
  const PAGE = 'ytmusic-player-page';
  const BAR = 'ytmusic-player-bar[slot="player-bar"]';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  let strings = {};
  let initialized = false;
  let wantOpen = false; // lo que eligió el usuario (se guarda en los ajustes)

  // Canción actual y su letra.
  let track = { videoId: '', title: '' }; // title: el de la barra cuando se pidió la letra
  let requested = false;
  let hasLyrics = false;

  // Elementos propios y lo que se observa.
  let info = null; // #md-np-info
  let titleEl = null;
  let artistEl = null;
  let btn = null;
  let boundVideo = null;
  let boundBarTitle = null;
  let boundPlayer = null;
  const cleanups = [];
  const barObserver = new MutationObserver(() => check('bar'));
  const modeObserver = new MutationObserver(() => applyState());

  function send(msg) {
    document.documentElement.dataset.mdLyricsMsg = JSON.stringify(msg);
    document.dispatchEvent(new Event('md-lyrics'));
  }
  const t = (key) => strings[key] || '';
  const page = () => document.querySelector(PAGE);
  const player = () => document.querySelector('#movie_player');
  // Escribe en el DOM solo si el valor cambia.
  function setAttr(el, name, value) {
    if (value === null) { if (el.hasAttribute(name)) el.removeAttribute(name); }
    else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }
  function setText(el, text) { if (el.textContent !== text) el.textContent = text; }

  // ---------- Elementos propios ----------
  function svgIcon() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    for (const [k, v] of Object.entries({ width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, String(v));
    for (const d of ['M4 5h16v11H9l-5 4z', 'M8 9h8', 'M8 12.5h5']) {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      svg.append(p);
    }
    return svg;
  }
  function build() {
    info = document.createElement('div');
    info.id = 'md-np-info';
    const text = document.createElement('div');
    text.className = 'md-np-text';
    titleEl = document.createElement('div');
    titleEl.className = 'md-np-title';
    artistEl = document.createElement('div');
    artistEl.className = 'md-np-artist';
    text.append(titleEl, artistEl);
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'md-lyrics-btn';
    btn.append(svgIcon());
    btn.addEventListener('click', () => {
      wantOpen = !wantOpen;
      send({ type: 'open', open: wantOpen });
      applyState();
    });
    info.append(text, btn);
  }
  // YT puede rehacer el panel: si falta, se vuelve a poner (al final de #main-panel).
  function ensureDom() {
    const panel = document.querySelector(`${PAGE} #main-panel`);
    if (panel && info.parentElement !== panel) panel.append(info);
    const pl = document.querySelector(`${PAGE} #player`);
    if (pl !== boundPlayer) {
      modeObserver.disconnect();
      boundPlayer = pl;
      if (pl) modeObserver.observe(pl, { attributes: true, attributeFilter: ['playback-mode'] });
    }
  }

  // ---------- Canción actual ----------
  // Título, artista y álbum de la barra visible. La línea de artista es "Artista • Álbum • Año"
  // en canciones; en vídeos es "Artista • N vistas • N me gusta" y entonces no hay álbum.
  function barInfo() {
    const bar = document.querySelector(BAR);
    const title = ((bar && bar.querySelector('.title')) || {}).textContent || '';
    const parts = (((bar && bar.querySelector('.byline')) || {}).textContent || '').split('•').map((s) => s.trim());
    const album = parts.length === 3 && /^\d{4}$/.test(parts[2]) ? parts[1] : '';
    return { title: title.trim(), artist: parts[0] || '', album };
  }

  // La barra puede cambiar de canción antes o después que el reproductor. Está lista si su
  // título coincide con el del reproductor o si ya no es el de la canción anterior.
  function barReady(bar, data) {
    return !!bar.title && (bar.title === (data.title || '').trim() || bar.title !== track.title);
  }

  // Duración del medio cargado: solo vale si ya es el de esta canción (el reproductor sabe
  // cuánto dura aunque el <video> aún tenga el anterior).
  function duration(video) {
    const d = video ? video.duration : NaN;
    if (!Number.isFinite(d) || d <= 0) return null;
    const p = player();
    const pd = p && p.getDuration ? p.getDuration() : 0;
    return pd > 0 && Math.abs(pd - d) > 3 ? null : d;
  }

  function bindVideo() {
    const video = document.querySelector(`${PAGE} video, #movie_player video`) || document.querySelector('video');
    if (video === boundVideo) return;
    for (const off of cleanups.splice(0)) off();
    boundVideo = video;
    if (!video) return;
    const on = (type, fn) => { video.addEventListener(type, fn, { passive: true }); cleanups.push(() => video.removeEventListener(type, fn)); };
    on('loadeddata', () => check('video'));
    on('durationchange', () => check('video'));
    on('playing', () => check('playing'));
  }
  function bindBar() {
    const el = document.querySelector(`${BAR} .title`);
    if (el === boundBarTitle) return;
    barObserver.disconnect();
    boundBarTitle = el;
    const bar = document.querySelector(BAR);
    if (el) barObserver.observe(el, { childList: true, characterData: true, subtree: true });
    const byline = bar && bar.querySelector('.byline');
    if (byline) barObserver.observe(byline, { childList: true, characterData: true, subtree: true });
  }

  function newTrack(videoId) {
    track = { videoId, title: track.title };
    requested = false;
    hasLyrics = false;
    applyState();
  }

  // Se llama en cada evento: mira si cambió la canción y, cuando hay datos, pide la letra.
  function check(source) {
    ensureDom();
    bindVideo();
    bindBar();
    const bar = barInfo();
    setText(titleEl, bar.title);
    setText(artistEl, bar.artist);
    const p = player();
    const data = p && p.getVideoData ? p.getVideoData() : null;
    const videoId = data && data.video_id;
    if (!videoId) return;
    if (videoId !== track.videoId) newTrack(videoId);
    if (requested || !barReady(bar, data)) return;
    // La duración no se lee al cambiar la barra (el <video> aún puede tener el medio anterior).
    // Si sonando sigue sin duración (p. ej. un directo), se pide sin ella.
    const dur = source === 'bar' ? null : duration(boundVideo);
    if (dur === null && source !== 'playing') return;
    requested = true;
    track.title = bar.title;
    send({ type: 'request', track: { videoId, title: bar.title, artist: bar.artist, album: bar.album, duration: dur } });
  }

  // ---------- Estado visible ----------
  function applyState() {
    const pp = page();
    if (!pp) return;
    const pl = document.querySelector(`${PAGE} #player`);
    const videoMode = !!pl && pl.getAttribute('playback-mode') !== 'ATV_PREFERRED';
    const shown = wantOpen && hasLyrics && !videoMode;
    setAttr(pp, 'data-md-video', videoMode ? '' : null);
    setAttr(pp, 'data-md-has-lyrics', hasLyrics ? '' : null);
    setAttr(pp, 'data-md-lyrics', shown ? 'open' : null);
    setAttr(btn, 'aria-pressed', String(shown));
    setAttr(btn, 'aria-label', t(shown ? 'lyrics.hide' : 'lyrics.show'));
    setAttr(btn, 'title', t(shown ? 'lyrics.hide' : 'lyrics.show'));
  }

  function receive(videoId, result) {
    if (videoId !== track.videoId || !result) return; // respuesta de una canción anterior
    hasLyrics = result.kind === 'synced' || result.kind === 'plain';
    applyState();
  }

  build();

  return {
    // Se llama al cargar y cada vez que llegan los textos (cambio de idioma): no duplica nada.
    init(opts) {
      opts = opts || {};
      if (opts.strings) strings = opts.strings;
      if (!initialized) {
        initialized = true;
        wantOpen = !!opts.open;
      }
      check('init');
      applyState();
    },
    receive,
    // Quita todo lo de esta versión (si el script se vuelve a ejecutar en el mismo documento).
    destroy() {
      for (const off of cleanups.splice(0)) off();
      barObserver.disconnect();
      modeObserver.disconnect();
      if (info) info.remove();
      const pp = page();
      if (pp) for (const a of ['data-md-lyrics', 'data-md-lyrics-mode', 'data-md-has-lyrics', 'data-md-video']) pp.removeAttribute(a);
    },
  };
})();

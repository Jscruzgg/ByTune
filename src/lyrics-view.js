// Letras en Now Playing (mundo principal de la página). main.js antepone lib/lyrics-timing.js
// (mdLyricsTiming) y lo ejecuta en cada carga dentro de un bloque { }; luego llama a init.
// Habla con main.js por preload.js: deja el mensaje en <html data-md-lyrics-msg> y lanza 'md-lyrics'.
// Dibuja su propia fila de título bajo la carátula (#md-np-info, con el botón de letras) y el área
// de letras (#md-lyrics). El estado va en atributos de ytmusic-player-page y el CSS (lyrics.css)
// hace todo el movimiento; aquí solo se miden tamaños cuando cambian. YouTube Music impone
// Trusted Types: nada de innerHTML. Sin bucles: todo va por eventos del <video>, del reproductor y
// de la barra.
if (window.__mdLyrics && window.__mdLyrics.destroy) window.__mdLyrics.destroy();
window.__mdLyrics = (() => {
  const PAGE = 'ytmusic-player-page';
  const BAR = 'ytmusic-player-bar[slot="player-bar"]';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  // Medidas del diseño (px). GUTTER: hueco a cada lado de la carátula en la mitad izquierda.
  const GUTTER = 24;
  const EDGE = 32; // margen de la disposición estrecha
  const THUMB = 88; // carátula en miniatura (disposición estrecha)
  const THUMB_GAP = 18;
  // Por debajo de estos anchos, carátula y letra no caben lado a lado: disposición estrecha.
  const MIN_COVER = 300;
  const MIN_LYRICS = 400; // ancho del área de letra (mitad derecha menos su margen de 40 px)

  let strings = {};
  let initialized = false;
  let wantOpen = false; // lo que eligió el usuario (se guarda en los ajustes)

  // Canción actual y su letra.
  let track = { videoId: '', title: '' }; // title: el de la barra cuando se pidió la letra
  let requested = false;
  let lyrics = null; // { kind: 'synced' | 'plain', lines, source } de la canción actual
  let loading = false; // vista abierta esperando la letra de una canción nueva
  let shown = false;

  // Elementos propios y lo que se observa.
  let info = null; // #md-np-info
  let titleEl = null;
  let artistEl = null;
  let btn = null;
  let area = null; // #md-lyrics
  let trackEl = null; // contenedor de las líneas (se desplaza con translateY)
  let boundVideo = null;
  let boundBarTitle = null;
  let boundPlayer = null;
  let boundPanel = null;
  const cleanups = [];
  const barObserver = new MutationObserver(() => check('bar'));
  const modeObserver = new MutationObserver(() => applyState());
  const sizeObserver = new ResizeObserver(() => measure());
  const vars = {}; // variables CSS escritas en <html> (para no repetir escrituras)

  function send(msg) {
    document.documentElement.dataset.mdLyricsMsg = JSON.stringify(msg);
    document.dispatchEvent(new Event('md-lyrics'));
  }
  const str = (key) => strings[key] || '';
  const page = () => document.querySelector(PAGE);
  const player = () => document.querySelector('#movie_player');
  // Escribe en el DOM solo si el valor cambia.
  function setAttr(el, name, value) {
    if (value === null) { if (el.hasAttribute(name)) el.removeAttribute(name); }
    else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }
  function setText(el, text) { if (el.textContent !== text) el.textContent = text; }
  function setVar(name, px) {
    const v = `${Math.round(px * 10) / 10}px`;
    if (vars[name] === v) return;
    vars[name] = v;
    document.documentElement.style.setProperty(name, v);
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

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
    info = el('div');
    info.id = 'md-np-info';
    const text = el('div', 'md-np-text');
    titleEl = el('div', 'md-np-title');
    artistEl = el('div', 'md-np-artist');
    text.append(titleEl, artistEl);
    btn = el('button', 'md-lyrics-btn');
    btn.type = 'button';
    btn.append(svgIcon());
    btn.addEventListener('click', () => {
      wantOpen = !wantOpen;
      send({ type: 'open', open: wantOpen });
      applyState();
    });
    info.append(text, btn);
    area = el('div');
    area.id = 'md-lyrics';
    trackEl = el('div', 'md-lyrics-track');
    area.append(trackEl);
  }
  // YT puede rehacer el panel: si falta, se vuelve a poner (la fila al final de #main-panel).
  function ensureDom() {
    const panel = document.querySelector(`${PAGE} #main-panel`);
    if (panel && info.parentElement !== panel) panel.append(info);
    if (panel && area.parentElement !== panel) panel.insertBefore(area, info);
    const pl = document.querySelector(`${PAGE} #player`);
    if (pl !== boundPlayer) {
      modeObserver.disconnect();
      boundPlayer = pl;
      if (pl) modeObserver.observe(pl, { attributes: true, attributeFilter: ['playback-mode'] });
    }
    if (panel !== boundPanel) {
      sizeObserver.disconnect();
      boundPanel = panel;
      if (panel) {
        for (const e of [panel, pl, panel.querySelector('#av-id'), info]) if (e) sizeObserver.observe(e);
      }
    }
  }

  // ---------- Medidas ----------
  // Se miden el panel, la carátula y la fila de título (sin transformaciones: offset* no las
  // ve) y se dejan en variables CSS de <html>; lyrics.css las usa para mover la columna.
  // Solo corre cuando algo cambia de tamaño o de estado, nunca por fotograma.
  function measure() {
    const pp = page();
    const panel = boundPanel;
    const cover = boundPlayer;
    const av = panel && panel.querySelector('#av-id');
    if (!pp || !panel || !cover || !info.isConnected) return;
    const W = panel.offsetWidth;
    const H = panel.offsetHeight;
    const cw = cover.offsetWidth;
    if (!W || !cw) return;
    const top = av ? av.offsetTop : cover.offsetTop;
    const bottom = info.offsetTop + info.offsetHeight;
    const fit = Math.min(cw, W / 2 - 2 * GUTTER);
    const narrow = fit < MIN_COVER || W / 2 - 40 < MIN_LYRICS;
    setAttr(pp, 'data-md-lyrics-narrow', narrow ? '' : null);
    setVar('--md-np-w', W);
    if (!narrow) {
      // Ancha: la columna (selector, carátula, título) se centra en la mitad izquierda y, si no
      // cabe con su hueco, se encoge alrededor de su centro.
      const s = fit / cw;
      const yc = (top + bottom) / 2;
      const dy = (e) => (e ? (1 - s) * (yc - (e.offsetTop + e.offsetHeight / 2)) : 0);
      document.documentElement.style.setProperty('--md-lyr-s', String(Math.round(s * 1000) / 1000));
      setVar('--md-lyr-tx', -W / 4);
      setVar('--md-lyr-av-y', dy(av));
      setVar('--md-lyr-cover-y', dy(cover));
      setVar('--md-lyr-info-y', dy(info));
      setVar('--md-lyr-top', yc - (s * (bottom - top)) / 2);
      setVar('--md-lyr-h', s * (bottom - top));
    } else {
      // Estrecha: miniatura arriba a la izquierda, título y botón a su lado, letra debajo.
      const infoW = W - 2 * EDGE - THUMB - THUMB_GAP;
      document.documentElement.style.setProperty('--md-lyr-thumb-s', String(Math.round((THUMB / cw) * 1000) / 1000));
      setVar('--md-lyr-thumb-x', EDGE + THUMB / 2 - (cover.offsetLeft + cw / 2));
      setVar('--md-lyr-thumb-y', EDGE + THUMB / 2 - (cover.offsetTop + cover.offsetHeight / 2));
      setVar('--md-lyr-ninfo-w', infoW);
      setVar('--md-lyr-ninfo-x', EDGE + THUMB + THUMB_GAP - (W - infoW) / 2);
      setVar('--md-lyr-ninfo-y', EDGE + THUMB / 2 - (info.offsetTop + info.offsetHeight / 2));
      setVar('--md-lyr-top', EDGE + THUMB + 24);
      setVar('--md-lyr-h', H - (EDGE + THUMB + 24) - EDGE);
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
    const video = document.querySelector('#movie_player video') || document.querySelector('video');
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
    const title = document.querySelector(`${BAR} .title`);
    if (title === boundBarTitle) return;
    barObserver.disconnect();
    boundBarTitle = title;
    const byline = document.querySelector(`${BAR} .byline`);
    for (const e of [title, byline]) if (e) barObserver.observe(e, { childList: true, characterData: true, subtree: true });
  }

  function newTrack(videoId) {
    track = { videoId, title: track.title };
    requested = false;
    loading = shown; // si la vista estaba abierta, se queda con líneas de espera
    lyrics = null;
    render();
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

  // ---------- Letra ----------
  // Las líneas se crean una vez por canción.
  function render() {
    const nodes = [];
    if (!lyrics) {
      // Tres líneas tenues mientras llega la letra.
      for (const w of [70, 52, 62]) {
        const line = el('div', 'md-line is-placeholder');
        const bar = el('span');
        bar.style.width = `${w}%`;
        line.append(bar);
        nodes.push(line);
      }
    } else if (lyrics.kind === 'synced') {
      for (const l of lyrics.lines) {
        const line = el('div', l.gap ? 'md-line is-gap' : 'md-line', l.text);
        line.dataset.t = String(l.t);
        nodes.push(line);
      }
      nodes.push(el('div', 'md-lyrics-credit', str('lyrics.credit')));
    } else {
      for (const text of lyrics.lines) nodes.push(text ? el('div', 'md-line', text) : el('div', 'md-line is-break'));
      if (lyrics.source) nodes.push(el('div', 'md-lyrics-credit', lyrics.source));
    }
    trackEl.replaceChildren(...nodes);
    trackEl.style.transform = '';
    area.scrollTop = 0;
  }

  // ---------- Estado visible ----------
  function applyState() {
    const pp = page();
    if (!pp) return;
    const pl = document.querySelector(`${PAGE} #player`);
    const videoMode = !!pl && pl.getAttribute('playback-mode') !== 'ATV_PREFERRED';
    const hasLyrics = !!lyrics;
    const wasShown = shown;
    shown = wantOpen && (hasLyrics || loading) && !videoMode;
    if (shown && !wasShown) measure();
    setAttr(pp, 'data-md-video', videoMode ? '' : null);
    setAttr(pp, 'data-md-has-lyrics', hasLyrics ? '' : null);
    setAttr(pp, 'data-md-lyrics-mode', lyrics ? lyrics.kind : null);
    setAttr(pp, 'data-md-lyrics', shown ? 'open' : null);
    setAttr(btn, 'aria-pressed', String(shown));
    setAttr(btn, 'aria-label', str(shown ? 'lyrics.hide' : 'lyrics.show'));
    setAttr(btn, 'title', str(shown ? 'lyrics.hide' : 'lyrics.show'));
  }

  function receive(videoId, result) {
    if (videoId !== track.videoId || !result) return; // respuesta de una canción anterior
    const ok = (result.kind === 'synced' || result.kind === 'plain') && Array.isArray(result.lines) && result.lines.length > 0;
    lyrics = ok ? { kind: result.kind, lines: result.lines, source: typeof result.source === 'string' ? result.source : '' } : null;
    loading = false;
    render();
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
      if (lyrics && lyrics.kind === 'synced') {
        const credit = trackEl.querySelector('.md-lyrics-credit');
        if (credit) setText(credit, str('lyrics.credit'));
      }
      applyState();
    },
    receive,
    // Quita todo lo de esta versión (si el script se vuelve a ejecutar en el mismo documento).
    destroy() {
      for (const off of cleanups.splice(0)) off();
      barObserver.disconnect();
      modeObserver.disconnect();
      sizeObserver.disconnect();
      info.remove();
      area.remove();
      const pp = page();
      if (pp) for (const a of ['data-md-lyrics', 'data-md-lyrics-mode', 'data-md-has-lyrics', 'data-md-video', 'data-md-lyrics-narrow']) pp.removeAttribute(a);
    },
  };
})();

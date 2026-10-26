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
  const BTN = 44; // botón de letras y su distancia a la esquina inferior derecha (lyrics.css)
  const BTN_INSET = 24;
  // Por debajo de estos anchos, carátula y letra no caben lado a lado: disposición estrecha.
  const MIN_COVER = 300;
  const MIN_LYRICS = 400; // ancho del área de letra (mitad derecha menos su margen de 40 px)
  const FORCE_AFTER = 6000; // sin haber podido pedir la letra, a los 6 s se pide con lo que haya
  const LOAD_TIMEOUT = 15000; // y, ya pedida, a los 15 s sin respuesta se da por no encontrada

  let strings = {};
  let initialized = false;
  let wantOpen = false; // lo que eligió el usuario (se guarda en los ajustes)

  // Canción actual y su letra.
  let track = { videoId: '', title: '' }; // title: el de la barra cuando se pidió la letra
  let requested = false;
  let lyrics = null; // { kind: 'synced' | 'plain', lines, source } de la canción actual
  // Estado de la letra de la canción actual: 'loading' (pedida o por pedir), 'ready' (hay letra)
  // o 'none' (ninguna de las dos fuentes tiene, o no hubo respuesta).
  let status = 'loading';
  let shown = false;
  let videoMode = false; // modo vídeo de Now Playing (data-md-video)
  const NONE_MS = 2000; // lo que puede durar el playback-mode NONE de un cambio de canción
  let noneSince = 0;
  let noneTimer = 0;

  // Sincronía (solo letra con tiempos): un único setTimeout hasta la siguiente línea.
  let times = []; // inicio de cada línea, en segundos
  let lineEls = [];
  let active = -2; // línea activa pintada (-2: ninguna pintada aún)
  let timer = 0;
  let offset = 0; // desplazamiento manual con la rueda (px)
  let wheelTimer = 0;
  let loadTimer = 0; // tope de espera de la letra con la vista abierta
  let lastY = null;
  let lastBase = null; // posición de seguimiento de la línea activa la última vez

  // Elementos propios y lo que se observa.
  let info = null; // #md-np-info
  let titleEl = null;
  let artistEl = null;
  let btn = null;
  let fsBtn = null; // pantalla completa, a la derecha del de letras
  let fsPaths = null; // <path> del icono de pantalla completa (cambia al entrar y salir)
  let avBtn = null; // Canción/Vídeo, a la izquierda del de letras: pulsa el selector de YT (oculto)
  let controlsTimer = 0; // esconde la barra de reproducción en pantalla completa
  let area = null; // #md-lyrics
  let trackEl = null; // contenedor de las líneas (se desplaza con translateY)
  let boundVideo = null;
  let boundBarTitle = null;
  let boundPlayer = null;
  let boundPanel = null;
  const cleanups = [];
  const barObserver = new MutationObserver(() => check('bar'));
  const modeObserver = new MutationObserver(() => applyState());
  // Now Playing abierto o cerrado (atributo player-page-open): sin él no corre ningún temporizador.
  const pageObserver = new MutationObserver(() => onPageChange());
  let boundPage = null;
  // Si cambia el tamaño (menú lateral, ventana), la columna va directa a su nuevo sitio
  // (data-md-snap quita la transición dos fotogramas): con ella se deslizaba desde la posición
  // vieja, cortada por la izquierda.
  const sizeObserver = new ResizeObserver(() => {
    const pp = page();
    if (pp) pp.setAttribute('data-md-snap', '');
    measure();
    requestAnimationFrame(() => requestAnimationFrame(() => { if (pp) pp.removeAttribute('data-md-snap'); }));
  });
  let observedSizes = [];
  // Si al empezar YT aún no ha creado la barra o el <video>, se espera a que aparezcan (y este
  // observador se apaga en cuanto los dos están enlazados).
  const startObserver = new MutationObserver(() => {
    if (document.querySelector(`${BAR} .title`) && document.querySelector('video') && document.querySelector(`${PAGE} #main-panel`)) check('init');
  });
  let waiting = false;
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
  // Variables CSS en <html>: solo se escriben si cambian. setVar en px, setNum sin unidad.
  function setVar(name, px) { setRaw(name, `${Math.round(px * 10) / 10}px`); }
  function setNum(name, n) { setRaw(name, String(Math.round(n * 1000) / 1000)); }
  function setRaw(name, v) {
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
  // Iconos de trazo (24×24). LYRICS_ICON: bocadillo; FS_ON / FS_OFF: entrar / salir de pantalla completa;
  // VIDEO_ICON / SONG_ICON: pantalla con play / auriculares (el modo al que se cambia).
  const LYRICS_ICON = ['M4 5h16v11H9l-5 4z', 'M8 9h8', 'M8 12.5h5'];
  const VIDEO_ICON = ['M3 6h18v12H3z', 'M10 9.5v5l4-2.5z'];
  const SONG_ICON = ['M4 18v-5a8 8 0 0 1 16 0v5', 'M4 15h3v5H4z', 'M17 15h3v5h-3z'];
  const FS_ON = ['M4 9V4h5', 'M15 4h5v5', 'M20 15v5h-5', 'M9 20H4v-5'];
  const FS_OFF = ['M9 4v5H4', 'M20 9h-5V4', 'M15 20v-5h5', 'M4 15h5v5'];
  function svgIcon(paths) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    for (const [k, v] of Object.entries({ width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, String(v));
    for (const d of paths) {
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
    btn = el('button', 'md-np-btn md-lyrics-btn');
    btn.type = 'button';
    btn.append(svgIcon(LYRICS_ICON));
    btn.addEventListener('click', () => {
      wantOpen = !wantOpen;
      send({ type: 'open', open: wantOpen });
      applyState();
    });
    fsBtn = el('button', 'md-np-btn md-fs-btn');
    fsBtn.type = 'button';
    const fsSvg = svgIcon(FS_ON);
    fsPaths = [...fsSvg.querySelectorAll('path')];
    fsBtn.append(fsSvg);
    fsBtn.addEventListener('click', () => {
      // Entrar: la ventana crece primero (la barra de tareas se va al pulsar) y, hasta que main.js
      // avisa (setFullscreen), lo de dentro se queda con el alto de antes (lyrics.css:
      // data-md-fs-pending); luego todo viaja a la vez. Al revés no vale: una transición de vista
      // se cancela si la ventana cambia de tamaño a medias.
      if (!fullscreen) {
        setVar('--md-win-h', innerHeight);
        setAttr(html, 'data-md-fs-pending', '');
      }
      send({ type: 'fullscreen', on: !fullscreen });
    });
    avBtn = el('button', 'md-np-btn md-av-btn');
    avBtn.type = 'button';
    const toVideo = svgIcon(VIDEO_ICON);
    toVideo.classList.add('md-av-video');
    const toSong = svgIcon(SONG_ICON);
    toSong.classList.add('md-av-song');
    avBtn.append(toVideo, toSong);
    avBtn.addEventListener('click', () => {
      const pp = page();
      const target = pp && pp.querySelector(`#av-id .${pp.hasAttribute('data-md-video') ? 'song' : 'video'}-button`);
      if (target) target.click();
    });
    info.append(text);
    area = el('div');
    area.id = 'md-lyrics';
    trackEl = el('div', 'md-lyrics-track');
    area.append(trackEl);
    // Clic en una línea: salta a ese momento (por el reproductor de YT, así su barra se entera).
    trackEl.addEventListener('click', (e) => {
      const line = e.target.closest('.md-line');
      if (!line || !lyrics || lyrics.kind !== 'synced' || line.dataset.t === undefined) return;
      const s = Number(line.dataset.t);
      const p = player();
      offset = 0; // tras saltar, vuelve a seguir la línea al momento
      clearTimeout(wheelTimer);
      area.classList.remove('is-manual');
      if (p && p.seekTo) p.seekTo(s, true);
      else if (boundVideo) boundVideo.currentTime = s;
    });
    // Rueda: mueve la letra a mano; 4 s después de la última vuelve sola a la línea actual.
    area.addEventListener('wheel', (e) => {
      if (!shown || !lyrics || lyrics.kind !== 'synced') return;
      offset += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
      area.classList.add('is-manual');
      place();
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => {
        offset = 0;
        area.classList.remove('is-manual');
        place();
      }, 4000);
    }, { passive: true });
  }
  // YT puede rehacer el panel: si falta, se vuelve a poner (la fila al final de #main-panel).
  function ensureDom() {
    const pp = page();
    if (pp !== boundPage) {
      pageObserver.disconnect();
      boundPage = pp;
      if (pp) pageObserver.observe(pp, { attributes: true, attributeFilter: ['player-page-open'] });
    }
    const panel = document.querySelector(`${PAGE} #main-panel`);
    if (panel && info.parentElement !== panel) panel.append(info);
    if (panel && area.parentElement !== panel) panel.insertBefore(area, info);
    // El botón va fijo en la esquina inferior derecha del panel (no se mueve con la carátula).
    if (panel && btn.parentElement !== panel) panel.insertBefore(btn, info);
    if (panel && fsBtn.parentElement !== panel) panel.insertBefore(fsBtn, info);
    if (panel && avBtn.parentElement !== panel) panel.insertBefore(avBtn, info);
    const pl = document.querySelector(`${PAGE} #player`);
    if (pl !== boundPlayer) {
      modeObserver.disconnect();
      boundPlayer = pl;
      if (pl) modeObserver.observe(pl, { attributes: true, attributeFilter: ['playback-mode'] });
    }
    // Se observan los tres aunque aparezcan en momentos distintos (YT crea la carátula después
    // del panel).
    boundPanel = panel;
    const sized = panel ? [panel, pl, info] : [];
    if (sized.length !== observedSizes.length || sized.some((e, i) => e !== observedSizes[i])) {
      sizeObserver.disconnect();
      observedSizes = sized;
      for (const e of sized) if (e) sizeObserver.observe(e);
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
    if (!pp || !panel || !cover || !info.isConnected) return;
    const W = panel.offsetWidth;
    const H = panel.offsetHeight;
    const cw = cover.offsetWidth;
    if (!W || !cw) return;
    const top = cover.offsetTop;
    const bottom = info.offsetTop + info.offsetHeight;
    const fit = Math.min(cw, W / 2 - 2 * GUTTER);
    // La letra termina por encima del botón (fijo en la esquina inferior derecha).
    const maxBottom = H - BTN_INSET - BTN - 16;
    const narrow = fit < MIN_COVER || W / 2 - 40 < MIN_LYRICS;
    setAttr(pp, 'data-md-lyrics-narrow', narrow ? '' : null);
    setVar('--md-np-w', W);
    if (!narrow) {
      // Ancha: la columna (carátula y título) se centra en la mitad izquierda y, si no cabe con
      // su hueco, se encoge alrededor de su centro.
      const s = fit / cw;
      const yc = (top + bottom) / 2;
      const dy = (e) => (1 - s) * (yc - (e.offsetTop + e.offsetHeight / 2));
      setNum('--md-lyr-s', s);
      setVar('--md-lyr-tx', -W / 4);
      setVar('--md-lyr-cover-y', dy(cover));
      setVar('--md-lyr-info-y', dy(info));
      const lyrTop = yc - (s * (bottom - top)) / 2;
      setVar('--md-lyr-top', lyrTop);
      setVar('--md-lyr-h', Math.min(yc + (s * (bottom - top)) / 2, maxBottom) - lyrTop);
    } else {
      // Estrecha: miniatura arriba a la izquierda, título a su lado, letra debajo. Todo con
      // transformaciones: cambiar anchos movería el panel de YT.
      const infoW = info.offsetWidth;
      const infoX = EDGE + THUMB + THUMB_GAP;
      setNum('--md-lyr-thumb-s', THUMB / cw);
      setVar('--md-lyr-thumb-x', EDGE + THUMB / 2 - (cover.offsetLeft + cw / 2));
      setVar('--md-lyr-thumb-y', EDGE + THUMB / 2 - (cover.offsetTop + cover.offsetHeight / 2));
      setVar('--md-lyr-ninfo-x', infoX - (W - infoW) / 2);
      // El texto no pasa del borde del panel (si no, un título largo se mete en la cola).
      setVar('--md-lyr-ninfo-w', Math.max(0, W - infoX - EDGE));
      setVar('--md-lyr-ninfo-y', EDGE + THUMB / 2 - (info.offsetTop + info.offsetHeight / 2));
      setVar('--md-lyr-top', EDGE + THUMB + 24);
      setVar('--md-lyr-h', Math.min(H - EDGE, maxBottom) - (EDGE + THUMB + 24));
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
    on('loadeddata', () => { check('video'); sync(); });
    on('durationchange', () => { check('video'); sync(); });
    on('playing', () => { check('playing'); sync(); });
    // Cualquier salto de tiempo o de velocidad recalcula la línea y el temporizador.
    for (const type of ['play', 'pause', 'seeked', 'ratechange']) on(type, sync);
    // Si se queda cargando, el tiempo no avanza: se para hasta 'playing'.
    on('waiting', stopTimer);
    // Red de seguridad: si la línea pintada ya no es la del tiempo real (p. ej. al pasar sola a la
    // siguiente canción, sin 'playing' ni 'seeked'), se vuelve a sincronizar. Solo compara números:
    // no toca el DOM salvo que haga falta corregir.
    on('timeupdate', () => {
      if (!running()) return;
      const t = now();
      if (t !== null && mdLyricsTiming.activeIndex(times, t) !== active) sync();
    });
  }
  // Tiempo de la canción actual. Se pregunta al reproductor de YT, que ya sabe el de la canción
  // nueva aunque el <video> aún informe el final de la anterior; si el reproductor todavía está en
  // otra canción, no hay tiempo fiable (null) y se espera al siguiente evento.
  function now() {
    const p = player();
    if (p && p.getCurrentTime && p.getVideoData) {
      const data = p.getVideoData();
      if (!data || data.video_id !== track.videoId) return null;
      const t = p.getCurrentTime();
      if (Number.isFinite(t)) return t;
    }
    return boundVideo ? boundVideo.currentTime : null;
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
    status = 'loading';
    lyrics = null;
    // Red de seguridad: si a los FORCE_AFTER aún no se pudo pedir la letra, se pide con lo que
    // haya; si a los LOAD_TIMEOUT no hubo respuesta, se muestra que no hay letra.
    clearTimeout(loadTimer);
    loadTimer = setTimeout(() => {
      if (track.videoId !== videoId || status !== 'loading') return;
      if (!requested) check('force');
      loadTimer = setTimeout(() => giveUp(videoId), LOAD_TIMEOUT - FORCE_AFTER);
    }, FORCE_AFTER);
    render();
    applyState();
  }
  function giveUp(videoId) {
    if (track.videoId !== videoId || status !== 'loading') return;
    status = 'none';
    render();
    applyState();
  }

  // Se llama en cada evento: mira si cambió la canción y, cuando hay datos, pide la letra.
  function check(source) {
    ensureDom();
    bindVideo();
    bindBar();
    const ready = !!boundVideo && !!boundBarTitle && !!info.parentElement;
    if (ready && waiting) {
      waiting = false;
      startObserver.disconnect();
    } else if (!ready && !waiting) {
      waiting = true;
      startObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
    const bar = barInfo();
    // Otra canción: título y artista entran con un fundido corto.
    if (bar.title && bar.title !== titleEl.textContent && !reduceMotion.matches) {
      titleEl.parentElement.animate([{ opacity: 0, translate: '0 8px' }, { opacity: 1, translate: '0 0' }], { duration: 400, easing: 'cubic-bezier(.22,.8,.3,1)' });
    }
    setText(titleEl, bar.title);
    setText(artistEl, bar.artist);
    const p = player();
    const data = p && p.getVideoData ? p.getVideoData() : null;
    const videoId = data && data.video_id;
    if (!videoId) return;
    if (videoId !== track.videoId) newTrack(videoId);
    if (requested || (!barReady(bar, data) && source !== 'force')) return;
    // duration() solo da la del medio de esta canción (el <video> puede tener aún el anterior).
    // Sin ella se espera a otro evento, salvo que ya esté sonando (p. ej. un directo, o si los
    // eventos del <video> llegaron antes de que la barra cambiara) o venza la espera ('force').
    const dur = duration(boundVideo);
    const sounding = !!boundVideo && !boundVideo.paused && boundVideo.currentTime > 0.5;
    if (dur === null && source !== 'playing' && source !== 'force' && !sounding) return;
    requested = true;
    track.title = bar.title;
    send({ type: 'request', track: { videoId, title: bar.title, artist: bar.artist, album: bar.album, duration: dur } });
  }

  // ---------- Letra ----------
  // Las líneas se crean una vez por canción.
  function render() {
    const nodes = [];
    if (status === 'none') {
      nodes.push(el('div', 'md-line md-lyrics-empty', str('lyrics.none')));
    } else if (!lyrics) {
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
      nodes.push(el('div', 'md-lyrics-note', str('lyrics.unsynced')));
      for (const text of lyrics.lines) nodes.push(text ? el('div', 'md-line', text) : el('div', 'md-line is-break'));
      // La de YouTube trae su propio texto de fuente; la de LRCLIB lleva el crédito traducido.
      const source = lyrics.source === 'LRCLIB' ? str('lyrics.credit') : lyrics.source;
      if (source) nodes.push(el('div', 'md-lyrics-credit', source));
    }
    trackEl.replaceChildren(...nodes);
    times = lyrics && lyrics.kind === 'synced' ? lyrics.lines.map((l) => l.t) : [];
    lineEls = times.length ? nodes.slice(0, times.length) : [];
    active = -2;
    offset = 0;
    lastY = null;
    lastBase = null;
    trackEl.style.transform = '';
    area.scrollTop = 0;
  }

  // ---------- Sincronía ----------
  function stopTimer() {
    clearTimeout(timer);
    timer = 0;
  }
  // Solo hay trabajo con la letra sincronizada a la vista: vista abierta, Now Playing abierto y
  // ventana visible.
  function running() {
    const pp = page();
    return shown && times.length > 0 && !!pp && pp.hasAttribute('player-page-open') && !document.hidden;
  }
  // Clases de las líneas: solo se tocan las que cambian de estado.
  function setActive(i) {
    if (i === active) return;
    const from = active === -2 ? 0 : Math.max(0, Math.min(i, active));
    const to = active === -2 ? lineEls.length - 1 : Math.max(i, active);
    for (let j = from; j <= to && j < lineEls.length; j++) {
      lineEls[j].classList.toggle('is-past', j < i);
      lineEls[j].classList.toggle('is-active', j === i);
    }
    active = i;
  }
  // Coloca la línea activa al 30 % del alto del área (menos el desplazamiento manual), sin salirse
  // del principio ni del final de la letra.
  function place() {
    const line = lineEls[Math.max(0, active)];
    if (!line) return;
    const anchor = area.clientHeight * 0.3;
    const base = anchor - line.offsetTop;
    // Mientras se mueve a mano, el seguimiento se para: si cambia la línea, la letra no se mueve.
    if (area.classList.contains('is-manual') && lastBase !== null) offset += base - lastBase;
    lastBase = base;
    const y = Math.max(anchor - trackEl.offsetHeight, Math.min(anchor, base - offset));
    offset = base - y;
    const value = Math.round(y);
    if (value === lastY) return;
    lastY = value;
    trackEl.style.transform = `translateY(${value}px)`;
  }
  function sync() {
    stopTimer();
    if (!running() || !boundVideo) return;
    const t = now();
    if (t === null) return;
    setActive(mdLyricsTiming.activeIndex(times, t));
    place();
    if (boundVideo.paused) return;
    const ms = mdLyricsTiming.msUntilNext(times, t, boundVideo.playbackRate);
    // Unos ms de margen para caer ya dentro de la línea siguiente.
    if (ms !== null) timer = setTimeout(sync, ms + 15);
  }

  // ---------- Estado visible ----------
  function applyState() {
    const pp = page();
    if (!pp) return;
    const pl = document.querySelector(`${PAGE} #player`);
    const mode = pl && pl.getAttribute('playback-mode');
    // Al cambiar de canción YT pasa casi un segundo por NONE: se queda el modo que había, sin saltos.
    // Si sigue en NONE pasado NONE_MS no era el cambio (p. ej. dos canciones pedidas muy seguidas):
    // YT enseña entonces el vídeo, y aquí también.
    if (mode === 'NONE') {
      if (!noneSince) {
        noneSince = Date.now();
        noneTimer = setTimeout(applyState, NONE_MS);
      } else if (Date.now() - noneSince >= NONE_MS) videoMode = true;
    } else {
      noneSince = 0;
      clearTimeout(noneTimer);
      if (mode) videoMode = mode !== 'ATV_PREFERRED';
    }
    // Al cambiar entre canción y vídeo, la carátula viaja a su nuevo formato (morph).
    if (videoMode !== pp.hasAttribute('data-md-video')) morph(writeState);
    else writeState();
  }
  function writeState() {
    const pp = page();
    if (!pp) return;
    const hasLyrics = !!lyrics;
    const wasShown = shown;
    // El botón siempre funciona (salvo en modo vídeo): sin letra, la vista dice que no la hay.
    shown = wantOpen && !videoMode;
    if (shown && !wasShown) measure();
    setAttr(pp, 'data-md-video', videoMode ? '' : null);
    setAttr(pp, 'data-md-has-lyrics', hasLyrics ? '' : null);
    setAttr(pp, 'data-md-lyrics-mode', lyrics ? lyrics.kind : status === 'none' ? 'none' : null);
    setAttr(pp, 'data-md-lyrics', shown ? 'open' : null);
    btn.disabled = videoMode; // sigue en su sitio: el resto de botones no se mueve
    setAttr(btn, 'aria-pressed', String(shown));
    setAttr(btn, 'aria-label', str(shown ? 'lyrics.hide' : 'lyrics.show'));
    setAttr(btn, 'title', str(shown ? 'lyrics.hide' : 'lyrics.show'));
    setAttr(avBtn, 'aria-label', str(videoMode ? 'np.toSong' : 'np.toVideo'));
    setAttr(avBtn, 'title', str(videoMode ? 'np.toSong' : 'np.toVideo'));
    if (!shown) {
      offset = 0;
      clearTimeout(wheelTimer);
      area.classList.remove('is-manual');
    }
    sync();
  }

  // Cambios de disposición (pantalla completa, canción/vídeo) con una transición de vista: la
  // carátula, el título, la letra y los botones de la esquina van de su sitio al nuevo en vez de
  // saltar (lyrics.css). Lo que llega mientras una espera su turno se aplica con ella.
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let morphQueue = null;
  function morph(update) {
    if (morphQueue) return void morphQueue.add(update);
    const pp = page();
    if (!document.startViewTransition || document.hidden || reduceMotion.matches || !(pp && pp.hasAttribute('player-page-open'))) return update();
    morphQueue = new Set([update]);
    document.startViewTransition(() => {
      const q = morphQueue;
      morphQueue = null;
      q.forEach((f) => f());
    });
  }

  function receive(videoId, result) {
    if (videoId !== track.videoId) return; // respuesta de una canción anterior
    clearTimeout(loadTimer);
    const ok = !!result && (result.kind === 'synced' || result.kind === 'plain') && Array.isArray(result.lines) && result.lines.length > 0;
    lyrics = ok ? { kind: result.kind, lines: result.lines, source: typeof result.source === 'string' ? result.source : '' } : null;
    status = ok ? 'ready' : 'none';
    render();
    applyState();
  }

  // ---------- Pantalla completa ----------
  // La ventana la pone a pantalla completa main.js (no la API del documento: con ella YT cambia a
  // su propio diseño de pantalla completa) y avisa con setFullscreen; Esc también sale (main.js).
  // lyrics.css deja solo el espacio de color de Now Playing. La barra de reproducción aparece con
  // el puntero cerca del borde de abajo; la superior sola cerca del de arriba, con el menú lateral
  // cerca del izquierdo y con la cola pegado al derecho; el puntero, al moverlo. Todo se esconde a los
  // CONTROLS_MS sin moverlo (salvo con el puntero sobre una barra, un panel o un menú).
  const CONTROLS_MS = 3000;
  const EDGE_PX = 150; // distancia al borde a la que aparece cada barra
  const SIDE_PX = 16; // la cola, solo pegado al borde: a 24 px están los botones de la esquina
  const NAV = 'ytmusic-nav-bar'; // barra superior
  const GUIDE = 'tp-yt-app-drawer#guide, #mini-guide'; // menú lateral (abierto / plegado)
  const SIDE = `${PAGE} #side-panel`; // la cola
  const POPUP = 'ytmusic-popup-container, tp-yt-iron-dropdown'; // menús abiertos desde las barras
  const html = document.documentElement;
  let fullscreen = false;
  function hideControls() {
    for (const a of ['data-md-pointer', 'data-md-controls', 'data-md-topbar', 'data-md-guide', 'data-md-side']) setAttr(html, a, null);
  }
  function hideControlsLater() {
    clearTimeout(controlsTimer);
    controlsTimer = setTimeout(hideControls, CONTROLS_MS);
  }
  function setFullscreen(on) {
    const fs = fullscreen = !!on;
    const apply = () => {
      if (fs) setVar('--md-screen-h', screen.height);
      setAttr(html, 'data-md-fs-pending', null);
      setAttr(html, 'data-md-fullscreen', fs ? '' : null);
      FS_ON.forEach((d, i) => fsPaths[i].setAttribute('d', fs ? FS_OFF[i] : d));
      const label = str(fs ? 'np.exitFullscreen' : 'np.fullscreen');
      setAttr(fsBtn, 'aria-label', label);
      setAttr(fsBtn, 'title', label);
      clearTimeout(controlsTimer);
      hideControls();
    };
    if (html.hasAttribute('data-md-fullscreen') !== fs) morph(apply);
    else apply();
  }
  const CORNER_PAD = 96; // margen a la izquierda y por encima de los botones de la esquina
  // La esquina de los botones: desde un poco a su izquierda y por encima hasta los bordes de la
  // pantalla, así se llega a ellos desde cualquier lado sin pasar por un disparador.
  function inCorner(e) {
    let l = Infinity, tp = Infinity;
    for (const x of [avBtn, btn, fsBtn]) {
      const rc = x.getBoundingClientRect();
      if (!rc.width) continue; // Canción/Vídeo oculto (canción sin vídeo)
      l = Math.min(l, rc.left);
      tp = Math.min(tp, rc.top);
    }
    return e.clientX >= l - CORNER_PAD && e.clientY >= tp - CORNER_PAD;
  }
  function onPointerMove(e) {
    if (!fullscreen) return;
    const t = e.target instanceof Element ? e.target : null;
    // Dentro de un menú (que puede quedar lejos del borde), las barras se quedan como están.
    if (!(t && t.closest(POPUP))) {
      // Menú lateral: solo desde el borde izquierdo (a cualquier altura).
      const guide = e.clientX < EDGE_PX || !!(t && t.closest(GUIDE));
      const top = e.clientY < EDGE_PX || !!(t && t.closest(NAV));
      let side = html.hasAttribute('data-md-side');
      // En la esquina de los botones, ni la barra de abajo ni la cola cambian: saldrían (y la de
      // abajo los subiría) justo cuando el puntero va a pulsarlos.
      if (!inCorner(e)) {
        setAttr(html, 'data-md-controls', e.clientY > innerHeight - EDGE_PX || (t && t.closest(BAR)) ? '' : null);
        side = e.clientX >= innerWidth - SIDE_PX || !!(t && t.closest(SIDE));
        setAttr(html, 'data-md-side', side ? '' : null);
      }
      setAttr(html, 'data-md-guide', guide ? '' : null);
      // La barra superior sale sola desde arriba, y también con el menú lateral y con la cola.
      setAttr(html, 'data-md-topbar', top || guide || side ? '' : null);
    }
    setAttr(html, 'data-md-pointer', '');
    if (t && t.closest(`${BAR}, ${NAV}, ${GUIDE}, ${SIDE}, ${POPUP}`)) clearTimeout(controlsTimer);
    else hideControlsLater();
  }
  // Al cerrar Now Playing, se sale de la pantalla completa (fuera de él no hay nada que mostrar), y
  // mientras baja la barra de desplazamiento de la página de detrás sigue transparente (lyrics.css).
  const CLOSING_MS = 400;
  let closingTimer = 0;
  function onPageChange() {
    const pp = page();
    if (pp && !pp.hasAttribute('player-page-open')) {
      if (fullscreen) send({ type: 'fullscreen', on: false });
      setAttr(html, 'data-md-np-closing', '');
      clearTimeout(closingTimer);
      closingTimer = setTimeout(() => setAttr(html, 'data-md-np-closing', null), CLOSING_MS);
    }
    sync();
  }

  build();
  document.addEventListener('visibilitychange', sync);
  document.addEventListener('pointermove', onPointerMove, { passive: true });

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
      setFullscreen(opts.fullscreen); // estado de la ventana y textos del botón
      if (lyrics && lyrics.kind === 'synced') {
        const credit = trackEl.querySelector('.md-lyrics-credit');
        if (credit) setText(credit, str('lyrics.credit'));
      }
      const note = trackEl.querySelector('.md-lyrics-note');
      if (note) setText(note, str('lyrics.unsynced'));
      applyState();
    },
    receive,
    setFullscreen,
    // Quita todo lo de esta versión (si el script se vuelve a ejecutar en el mismo documento).
    destroy() {
      for (const off of cleanups.splice(0)) off();
      document.removeEventListener('visibilitychange', sync);
      document.removeEventListener('pointermove', onPointerMove);
      clearTimeout(controlsTimer);
      clearTimeout(noneTimer);
      stopTimer();
      clearTimeout(wheelTimer);
      clearTimeout(loadTimer);
      barObserver.disconnect();
      modeObserver.disconnect();
      pageObserver.disconnect();
      startObserver.disconnect();
      sizeObserver.disconnect();
      info.remove();
      area.remove();
      btn.remove();
      fsBtn.remove();
      avBtn.remove();
      const pp = page();
      if (pp) for (const a of ['data-md-lyrics', 'data-md-lyrics-mode', 'data-md-has-lyrics', 'data-md-video', 'data-md-lyrics-narrow', 'data-md-snap']) pp.removeAttribute(a);
      hideControls();
      clearTimeout(closingTimer);
      html.removeAttribute('data-md-fullscreen');
      html.removeAttribute('data-md-np-closing');
      html.removeAttribute('data-md-fs-pending');
    },
  };
})();

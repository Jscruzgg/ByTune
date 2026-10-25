// API de la app dentro de la página de YouTube Music. Se ejecuta en el contexto de la página
// (webContents.executeJavaScript desde main.js), donde están ytcfg, las cookies de la sesión y los
// elementos de YT, e instala window.__md. Se puede ejecutar varias veces: solo (re)instala el objeto.
// Todos los métodos devuelven una promesa y, salvo browse, nunca lanzan: si algo falla, resuelven { error }.
//   browse(body)              petición autenticada a /youtubei/v1/browse; lanza si falla (la usa covers.js)
//   library()                 -> { items: LibraryItem[] }  playlists y álbumes de la biblioteca
//   searchSongs(q)            -> { songs: Song[] }         hasta 5 canciones
//   suggestions()             -> { songs: Song[] }         hasta 5 canciones del inicio ("Selección rápida")
//   play(videoId)             -> { ok: true }              como pulsar la canción en la búsqueda de YT
//   queue(videoId, 'end'|'next') -> { ok: true }          "Añadir a la cola" / "Reproducir a continuación"
//   open(browseId)            -> { ok: true }              abre el álbum o la playlist sin recargar
//   lyrics(videoId)           -> { lines: string[], source } | { none: true }  letra en texto plano de YT (sirve sin sesión);
//                                 las líneas vacías separan estrofas
// LibraryItem: { id: browseId ('VL…' playlist, 'MPRE…' álbum), type: 'playlist'|'album', title, artist?, cover,
//   playlistId? (solo álbumes: el 'OLAK5uy_…' de su página /playlist?list=…) }
// Song: { videoId, title, artist, duration, cover }
(() => {
  // Filtro "Canciones" de la búsqueda: el valor `params` que envía el chip "Canciones" de la propia
  // página de búsqueda de YT Music (capturado de la petición /youtubei/v1/search al pulsarlo).
  const SONGS_PARAMS = 'EgWKAQIIAWoSEAQQBRADEAkQChAVEBAQDhAR';
  const PAGE_TYPE = { playlist: 'MUSIC_PAGE_TYPE_PLAYLIST', album: 'MUSIC_PAGE_TYPE_ALBUM' };
  const MAX_PAGES = 10;

  // Petición a la API interna con la autorización que usa la propia web:
  // SAPISIDHASH = SHA-1 de "hora SAPISID origen". Sin sesión iniciada lanza 'sin sesión',
  // salvo con { auth: 'optional' }: entonces se envía sin Authorization ni X-Goog-AuthUser.
  const cookie = (name) => (document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)')) || [])[1];
  const api = async (path, body, { auth = 'required' } = {}) => {
    const cfg = window.ytcfg;
    if (!cfg || !cfg.get) throw new Error('sin ytcfg');
    const sapisid = cookie('SAPISID') || cookie('__Secure-3PAPISID');
    if (!sapisid && auth !== 'optional') throw new Error('sin sesión');
    const headers = { 'Content-Type': 'application/json', 'X-Origin': location.origin };
    if (sapisid) {
      const ts = Math.floor(Date.now() / 1000);
      const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${ts} ${sapisid} ${location.origin}`));
      const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
      headers.Authorization = `SAPISIDHASH ${ts}_${hash}`;
      headers['X-Goog-AuthUser'] = String(cfg.get('SESSION_INDEX') || 0);
    }
    const res = await fetch(`/youtubei/v1/${path}?prettyPrint=false&key=${cfg.get('INNERTUBE_API_KEY')}`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ context: cfg.get('INNERTUBE_CONTEXT'), ...body }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  };
  const browse = (body) => api('browse', body);

  // Envuelve un método para que resuelva { error } en vez de lanzar.
  const safe = (fn) => async (...args) => {
    try { return await fn(...args); } catch (e) { return { error: String((e && e.message) || e) }; }
  };

  // Recorre un objeto de la respuesta y llama a visit(o) en cada nodo.
  const walk = (o, visit) => {
    if (!o || typeof o !== 'object') return;
    visit(o);
    for (const v of Object.values(o)) walk(v, visit);
  };
  const text = (t) => ((t && t.runs) || []).map((r) => r.text || '').join('');
  const pageTypeOf = (run) => {
    const ep = run.navigationEndpoint && run.navigationEndpoint.browseEndpoint;
    const cfg = ep && ep.browseEndpointContextSupportedConfigs && ep.browseEndpointContextSupportedConfigs.browseEndpointContextMusicConfig;
    return cfg && cfg.pageType;
  };
  // Los subtítulos de YT son tramos separados por " • " ("Álbum • Artista • 2020",
  // "Artista y Otro • Álbum • 3:45"). Devuelve cada tramo con sus runs.
  const segments = (t) => {
    const out = [[]];
    for (const r of (t && t.runs) || []) {
      if (String(r.text || '').trim() === '•') out.push([]);
      else out[out.length - 1].push(r);
    }
    return out.filter((s) => s.length).map((runs) => ({ runs, text: runs.map((r) => r.text || '').join('').trim() }));
  };
  // El tramo de artistas es el que tiene enlaces a páginas de artista (con sus " y ", ", ").
  const artistOf = (segs, fallback) => {
    const s = segs.find((x) => x.runs.some((r) => pageTypeOf(r) === 'MUSIC_PAGE_TYPE_ARTIST'));
    return s ? s.text : fallback;
  };
  // Miniatura más pequeña que siga nítida en la fila del menú (≥ 120 px); si no hay, la mayor.
  const coverOf = (thumbs) => {
    const list = (thumbs || []).filter((t) => t && t.url);
    const pick = list.find((t) => t.width >= 120) || list[list.length - 1];
    return pick ? pick.url : '';
  };
  const nextToken = (json) => {
    let next = null;
    walk(json, (o) => {
      if (o.nextContinuationData && o.nextContinuationData.continuation) next = o.nextContinuationData.continuation;
      if (o.continuationCommand && o.continuationCommand.token) next = o.continuationCommand.token;
    });
    return next;
  };

  // Tarjeta de la biblioteca (musicTwoRowItemRenderer) -> LibraryItem, o null si no es playlist ni álbum
  // (por ejemplo la tarjeta "Nueva lista").
  const libraryItem = (item) => {
    const ep = item.navigationEndpoint && item.navigationEndpoint.browseEndpoint;
    const id = ep && ep.browseId;
    if (!id) return null;
    const type = id.startsWith('VL') ? 'playlist' : id.startsWith('MPRE') ? 'album' : null;
    if (!type) return null;
    const title = text(item.title).trim();
    const thumbs = (((item.thumbnailRenderer || {}).musicThumbnailRenderer || {}).thumbnail || {}).thumbnails;
    const out = { id, type, title, cover: coverOf(thumbs) };
    if (type === 'album') {
      // "Álbum • Artista • 2020": sin enlace de artista se usa el tramo del medio.
      const segs = segments(item.subtitle);
      const artist = artistOf(segs, segs.length >= 2 ? segs[1].text : '');
      if (artist) out.artist = artist;
      // Al abrirlo, YT pasa a /playlist?list=OLAK5uy_…: se guarda ese id para reconocerlo en Recientes.
      // Sale del botón de reproducir de la portada; si no está, del menú de la tarjeta.
      const play = ((((item.thumbnailOverlay || {}).musicItemThumbnailOverlayRenderer || {}).content || {}).musicPlayButtonRenderer || {}).playNavigationEndpoint || {};
      let playlistId = (play.watchEndpoint || play.watchPlaylistEndpoint || {}).playlistId;
      if (!playlistId) walk(item.menu, (o) => { if (!playlistId && o.watchPlaylistEndpoint && /^OLAK/.test(o.watchPlaylistEndpoint.playlistId || '')) playlistId = o.watchPlaylistEndpoint.playlistId; });
      if (typeof playlistId === 'string' && /^[\w-]+$/.test(playlistId)) out.playlistId = playlistId;
    }
    return title ? out : null;
  };

  // Una sección de la biblioteca (playlists o álbumes) con sus páginas siguientes.
  const librarySection = async (browseId, items, seen) => {
    const collect = (json) => {
      walk(json, (o) => {
        if (!o.musicTwoRowItemRenderer) return;
        const it = libraryItem(o.musicTwoRowItemRenderer);
        if (it && !seen.has(it.id)) { seen.add(it.id); items.push(it); }
      });
      return nextToken(json);
    };
    let next = collect(await browse({ browseId }));
    for (let page = 0; next && page < MAX_PAGES; page++) next = collect(await browse({ continuation: next }));
  };

  const library = async () => {
    const items = [];
    const seen = new Set();
    const errors = [];
    // Cada sección por separado: si falla una (o una página intermedia), se devuelve lo conseguido.
    for (const id of ['FEmusic_liked_playlists', 'FEmusic_liked_albums']) {
      try { await librarySection(id, items, seen); } catch (e) { errors.push(String((e && e.message) || e)); }
    }
    if (!items.length) return { error: errors[0] || 'biblioteca vacía' };
    return { items };
  };

  // Fila de resultados (musicResponsiveListItemRenderer) -> Song, o null si no es una canción.
  const songOf = (r) => {
    const cols = (r.flexColumns || []).map((c) => (c.musicResponsiveListItemFlexColumnRenderer || {}).text);
    const titleRun = cols[0] && cols[0].runs && cols[0].runs[0];
    const watch = titleRun && titleRun.navigationEndpoint && titleRun.navigationEndpoint.watchEndpoint;
    const videoId = (r.playlistItemData && r.playlistItemData.videoId) || (watch && watch.videoId);
    if (!videoId) return null;
    const segs = segments(cols[1]);
    const fixed = (r.fixedColumns || []).map((c) => text((c.musicResponsiveListItemFixedColumnRenderer || {}).text).trim());
    const duration = [...segs.map((s) => s.text), ...fixed].reverse().find((s) => /^\d+(:\d\d)+$/.test(s)) || '';
    const thumbs = (((r.thumbnail || {}).musicThumbnailRenderer || {}).thumbnail || {}).thumbnails;
    return { videoId, title: text(cols[0]).trim(), artist: artistOf(segs, segs.length ? segs[0].text : ''), duration, cover: coverOf(thumbs) };
  };

  // Las primeras 5 canciones distintas de una respuesta.
  const firstSongs = (json) => {
    const songs = [];
    const seen = new Set();
    walk(json, (o) => {
      if (songs.length >= 5 || !o.musicResponsiveListItemRenderer) return;
      const s = songOf(o.musicResponsiveListItemRenderer);
      if (s && !seen.has(s.videoId)) { seen.add(s.videoId); songs.push(s); }
    });
    return songs;
  };

  const searchSongs = async (q) => {
    const query = String(q == null ? '' : q).trim();
    if (!query) return { songs: [] };
    return { songs: firstSongs(await api('search', { query, params: SONGS_PARAMS })) };
  };

  // Primeras canciones del inicio de YT Music: la estantería "Selección rápida" es la primera con filas de canción.
  const suggestions = async () => ({ songs: firstSongs(await browse({ browseId: 'FEmusic_home' })) });

  // Reproducir, encolar y abrir pasan por el propio manejo de comandos de YT Music, sin tocar
  // location: así no se recarga la página y la reproducción sigue.
  const app = () => {
    const a = document.querySelector('ytmusic-app');
    if (!a || typeof a.handleNavigationEndpoint !== 'function') throw new Error('sin ytmusic-app');
    return a;
  };
  const checkVideoId = (videoId) => {
    if (typeof videoId !== 'string' || !/^[\w-]{11}$/.test(videoId)) throw new Error('videoId inválido');
  };

  // Lo mismo que pulsar una canción en la búsqueda de YT: su watchEndpoint pasa por el navegador
  // de ytmusic-app, que sustituye la cola por esa canción más la radio automática.
  const play = async (videoId) => {
    checkVideoId(videoId);
    app().handleNavigationEndpoint({ watchEndpoint: { videoId } });
    return { ok: true };
  };

  // "Añadir a la cola" / "Reproducir a continuación" del menú de una canción: un queueAddEndpoint
  // que atiende el elemento del menú (ytmusic-menu-service-item-renderer.handleCommand), el que pide
  // la cola al servidor y la inserta. Se crea uno oculto, se le pasa el comando y se quita.
  // Con la cola vacía YT reproduce la canción (onEmptyQueue), como hace su menú.
  const queue = async (videoId, position) => {
    checkVideoId(videoId);
    const where = { end: 'INSERT_AT_END', next: 'INSERT_AFTER_CURRENT_VIDEO' }[position];
    if (!where) throw new Error('posición inválida');
    const host = app();
    const item = document.createElement('ytmusic-menu-service-item-renderer');
    if (typeof item.handleCommand !== 'function') throw new Error('sin menú de YT');
    item.hidden = true;
    host.appendChild(item);
    try {
      await item.handleCommand({
        queueAddEndpoint: {
          queueTarget: { videoId, onEmptyQueue: { watchEndpoint: { videoId } } },
          queueInsertPosition: where,
        },
      });
    } finally {
      item.remove();
    }
    return { ok: true };
  };

  // Abre el álbum o la playlist como un enlace interno de YT (browseEndpoint): sin recarga.
  const open = async (browseId) => {
    const type = typeof browseId !== 'string' ? null : /^VL[\w-]+$/.test(browseId) ? 'playlist' : /^MPRE[\w-]+$/.test(browseId) ? 'album' : null;
    if (!type) throw new Error('browseId inválido');
    app().handleNavigationEndpoint({
      browseEndpoint: {
        browseId,
        browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: PAGE_TYPE[type] } },
      },
    });
    return { ok: true };
  };

  // Letra en texto plano de YT: la pestaña "Letra" del reproductor (browseId 'MPLYt…', sale de `next`)
  // lleva un musicDescriptionShelfRenderer con la letra y el crédito ("Fuente: …"). Sin pestaña o
  // sin letra -> { none: true }. No necesita sesión.
  const lyrics = async (videoId) => {
    checkVideoId(videoId);
    let browseId = null;
    walk(await api('next', { videoId }, { auth: 'optional' }), (o) => {
      const id = o.browseEndpoint && o.browseEndpoint.browseId;
      if (!browseId && typeof id === 'string' && id.startsWith('MPLYt')) browseId = id;
    });
    if (!browseId) return { none: true };
    let shelf = null;
    walk(await api('browse', { browseId }, { auth: 'optional' }), (o) => { if (!shelf && o.musicDescriptionShelfRenderer) shelf = o.musicDescriptionShelfRenderer; });
    const body = shelf && text(shelf.description);
    if (!body || !body.trim()) return { none: true };
    // Las líneas vacías se conservan: son los saltos de estrofa.
    return { lines: body.split('\n'), source: text(shelf.footer).trim() };
  };

  window.__md = {
    browse,
    library: safe(library),
    searchSongs: safe(searchSongs),
    suggestions: safe(suggestions),
    play: safe(play),
    queue: safe(queue),
    open: safe(open),
    lyrics: safe(lyrics),
  };
  return true;
})()

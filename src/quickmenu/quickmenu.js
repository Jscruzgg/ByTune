// Menú rápido: interfaz y teclado. Corre en la ventana del menú; window.qm lo define preload.js.
// Los datos vienen de la página de YouTube Music (mundo principal, no son de fiar): todo texto va con
// textContent y las portadas solo como img.src, y solo si empiezan por https://.

// Envuelve una función async para que solo se entregue el resultado de la última llamada.
// Las llamadas viejas resuelven con undefined (y sus errores se ignoran); la última propaga su resultado o error.
function latestOnly(fn) {
  let ultima = 0;
  return async function (...args) {
    const mia = ++ultima;
    let resultado;
    try {
      resultado = await fn.apply(this, args);
    } catch (err) {
      if (mia !== ultima) return undefined;
      throw err;
    }
    return mia === ultima ? resultado : undefined;
  };
}

if (typeof module !== 'undefined') module.exports = { latestOnly };

if (typeof document !== 'undefined') {
  const TOAST_MS = 2200;
  const NOTE_KEY = { added: 'qm.added', playingNext: 'qm.playingNext', failed: 'qm.queueFailed' };

  const input = document.getElementById('q');
  const list = document.getElementById('list');
  const foot = document.getElementById('foot');
  const panel = document.getElementById('qm');
  const toast = document.getElementById('toast');
  const np = document.getElementById('np');
  const more = document.getElementById('more');

  let strings = {};
  let shiftEnter = 'queue';
  let recent = [];
  let suggested = [];
  let toastTimer = 0;
  let pieAbierto = false; // pie con todos los atajos; se recoge cada vez que se abre el menú
  let library = [];
  let songs = [];
  let songsText = '';
  let latestSeq = 0;
  let flat = [];
  let selIndex = 0;
  let selKey = null;
  let rows = new Map(); // filas ya creadas (por clave) para no recrear el DOM ni las portadas al teclear
  let activando = false; // hay una activación en curso: no se lanza otra hasta que responda

  const t = (key) => strings[key] || '';
  const joinar = (...partes) => partes.filter(Boolean).join(' · ');
  const claveDe = (item) => item.kind + ':' + item.id;
  const hayPortada = (url) => typeof url === 'string' && url.startsWith('https://');

  // Elemento de la biblioteca o canción -> { kind, id, title, cover, details }
  function normalizar(item) {
    if (!item) return null;
    if (item.videoId) {
      return { kind: 'song', id: item.videoId, title: item.title, cover: item.cover, details: joinar(item.artist, item.duration) };
    }
    if (!item.id) return null;
    if (item.type === 'album') {
      return { kind: 'album', id: item.id, title: item.title, cover: item.cover, details: joinar(t('qm.album'), item.artist) };
    }
    return { kind: 'playlist', id: item.id, title: item.title, cover: item.cover, details: t('qm.playlist') };
  }

  const normalizarTodos = (arr) => (Array.isArray(arr) ? arr.map(normalizar).filter(Boolean) : []);

  function crearFila(item) {
    const row = document.createElement('div');
    row.className = 'qm-row';
    row.setAttribute('role', 'option');
    let art;
    if (hayPortada(item.cover)) {
      art = document.createElement('img');
      art.alt = '';
      art.draggable = false;
      // Si la portada no carga, se cambia por el recuadro gris
      const img = art;
      img.addEventListener('error', () => {
        const vacio = document.createElement('div');
        vacio.className = 'qm-art';
        img.replaceWith(vacio);
      });
      art.src = item.cover;
    } else {
      art = document.createElement('div');
    }
    art.className = 'qm-art';
    const title = document.createElement('span');
    title.className = 'qm-title';
    title.textContent = item.title || '';
    const meta = document.createElement('span');
    meta.className = 'qm-meta';
    meta.textContent = item.details;
    row.append(art, title, meta);
    return row;
  }

  function filaDe(item) {
    const key = claveDe(item);
    let row = rows.get(key);
    if (!row) {
      row = crearFila(item);
      rows.set(key, row);
    }
    return row;
  }

  const escribiendo = () => input.value.trim() !== '';

  function secciones() {
    if (!escribiendo()) {
      return [
        { label: t('qm.recent'), items: normalizarTodos(recent) },
        { label: t('qm.suggested'), items: normalizarTodos(suggested) },
      ];
    }
    return [
      { label: t('qm.library'), items: normalizarTodos(library) },
      { label: t('qm.songs'), items: normalizarTodos(songs) },
    ];
  }

  function pintarSeleccion() {
    flat.forEach((f, i) => {
      const activa = i === selIndex;
      f.row.classList.toggle('sel', activa);
      f.row.setAttribute('aria-selected', activa ? 'true' : 'false');
    });
    const actual = flat[selIndex];
    if (actual) {
      input.setAttribute('aria-activedescendant', actual.row.id);
      actual.row.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function render() {
    const frag = document.createDocumentFragment();
    flat = [];
    let primera = true;
    for (const sec of secciones()) {
      if (!sec.items.length) continue; // las secciones vacías no se pintan
      if (!primera) {
        const div = document.createElement('div');
        div.className = 'qm-div';
        frag.append(div);
      }
      primera = false;
      const label = document.createElement('div');
      label.className = 'qm-label';
      label.textContent = sec.label;
      frag.append(label);
      for (const item of sec.items) {
        const row = filaDe(item);
        row.id = 'qm-r' + flat.length;
        flat.push({ item, row, key: claveDe(item) });
        frag.append(row);
      }
    }
    list.replaceChildren(frag);
    panel.classList.toggle('empty', flat.length === 0);
    // Se conserva la selección si sigue en la lista; si no, la primera fila.
    const idx = selKey ? flat.findIndex((f) => f.key === selKey) : -1;
    selIndex = idx >= 0 ? idx : 0;
    selKey = flat[selIndex] ? flat[selIndex].key : null;
    pintarSeleccion();
  }

  function mover(delta) {
    if (!flat.length) return;
    selIndex = (selIndex + delta + flat.length) % flat.length;
    selKey = flat[selIndex].key;
    pintarSeleccion();
  }

  function mostrarAviso(texto, cancion, error) {
    clearTimeout(toastTimer);
    document.getElementById('toastText').textContent = texto;
    document.getElementById('toastSong').textContent = cancion || '';
    toast.classList.toggle('err', error);
    toast.classList.add('show');
    toastTimer = setTimeout(() => toast.classList.remove('show'), TOAST_MS);
  }

  function ocultarAviso() {
    clearTimeout(toastTimer);
    toast.classList.remove('show');
  }

  // Buscando canciones: rueda en el campo hasta que llegan (o fallan).
  const cargando = (si) => {
    panel.classList.toggle('loading', si);
    list.setAttribute('aria-busy', si ? 'true' : 'false');
  };

  // --- Lo que suena: título, artista y anterior / reproducir-pausa / siguiente ---
  function pintarTrack(tr) {
    tr = tr || {};
    np.classList.toggle('off', !tr.title); // sin canción no hay nada que controlar
    np.classList.toggle('playing', !!tr.playing);
    document.getElementById('npTitle').textContent = tr.title || '';
    document.getElementById('npArtist').textContent = tr.artist || '';
    const etiqueta = { previous: 'tray.previous', playPause: tr.playing ? 'tray.pause' : 'tray.play', next: 'tray.next' };
    for (const b of np.querySelectorAll('button')) b.setAttribute('aria-label', t(etiqueta[b.dataset.act]));
  }

  function activar(shift, indice = selIndex) {
    const actual = flat[indice];
    if (!actual) return;
    const { kind, id } = actual.item;
    if (shift && kind !== 'song') return; // Mayús + Intro solo vale para canciones
    if (activando) return;
    activando = true;
    Promise.resolve(window.qm.activate({ kind, id }, shift))
      .then((res) => {
        const key = res && res.keepOpen && NOTE_KEY[res.note];
        if (key && t(key)) mostrarAviso(t(key), actual.item.title, res.note === 'failed');
      })
      .catch(() => {})
      .finally(() => { activando = false; });
  }

  function pintarPie() {
    const hint = (tecla, texto) => {
      const s = document.createElement('span');
      const k = document.createElement('kbd');
      k.textContent = tecla;
      s.append(k, ' ' + texto);
      return s;
    };
    // Las teclas van con el nombre impreso en el teclado (Shift, Enter) en todos los idiomas, como el atajo en los ajustes.
    const hints = [
      hint('Shift + Enter', t(shiftEnter === 'next' ? 'qm.nextHint' : 'qm.queueHint')),
      hint('Alt + ← ↓ →', t('qm.playback')),
    ];
    if (pieAbierto) hints.push(hint('↑↓', t('qm.move')), hint('Enter', t('qm.playOpen')), hint('Esc', t('qm.close')));
    foot.replaceChildren(...hints);
    more.setAttribute('aria-expanded', String(pieAbierto));
    more.setAttribute('aria-label', t('qm.allShortcuts'));
    more.title = t('qm.allShortcuts');
  }

  function alternarPie() {
    pieAbierto = !pieAbierto;
    pintarPie();
  }

  // --- Búsqueda: la biblioteca responde al instante y las canciones llegan después por onSongs ---
  const consultar = latestOnly((seq, text) => window.qm.query(seq, text));

  function alEscribir() {
    const seq = ++latestSeq;
    const text = input.value;
    selKey = null; // al cambiar la consulta, vuelve a la primera fila
    if (!text.trim()) {
      library = [];
      songs = [];
      cargando(false);
      render();
      return;
    }
    cargando(true);
    // Las canciones anteriores se quedan mientras la consulta nueva sea una ampliación o recorte de la
    // anterior (sin parpadeos); si cambia del todo, se quitan.
    if (songs.length && !(text.startsWith(songsText) || songsText.startsWith(text))) songs = [];
    songsText = text;
    consultar(seq, text)
      .then((res) => {
        if (!res || res.seq !== latestSeq) return;
        library = Array.isArray(res.library) ? res.library : [];
        if (Array.isArray(res.songs)) { // ya estaban en la caché: no hay que esperar a onSongs
          songs = res.songs;
          cargando(false);
        }
        render();
      })
      .catch(() => {});
  }

  function alLlegarCanciones(msg) {
    if (!msg || msg.seq !== latestSeq || !escribiendo()) return; // canciones de una consulta vieja
    songs = Array.isArray(msg.songs) ? msg.songs : []; // null o error: sección oculta
    songsText = input.value;
    cargando(false);
    render();
  }

  function alMostrar(data) {
    data = data || {};
    strings = data.strings || {};
    shiftEnter = data.shiftEnter === 'next' ? 'next' : 'queue';
    recent = Array.isArray(data.recent) ? data.recent : [];
    suggested = Array.isArray(data.suggested) ? data.suggested : [];
    library = [];
    songs = [];
    songsText = '';
    activando = false;
    latestSeq++; // descarta respuestas pendientes de la vez anterior
    cargando(false);
    ocultarAviso();
    pintarTrack(data.track);
    pieAbierto = false;
    rows = new Map();
    selKey = null;
    input.value = '';
    input.placeholder = t('qm.placeholder');
    pintarPie();
    render();
    input.focus();
  }

  document.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    // Alt + ← ↓ →: anterior / reproducir-pausa / siguiente, también mientras se escribe.
    const accion = e.altKey && { ArrowLeft: 'previous', ArrowDown: 'playPause', ArrowRight: 'next' }[e.key];
    if (accion) {
      e.preventDefault();
      if (!e.repeat) window.qm.player(accion);
      return;
    }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); mover(1); break;
      case 'ArrowUp': e.preventDefault(); mover(-1); break;
      // Con la tecla mantenida no se repite (si no, Mayús + Intro encolaría la canción muchas veces).
      case 'Enter': e.preventDefault(); if (!e.repeat) activar(e.shiftKey); break;
      case 'Escape': e.preventDefault(); window.qm.close(); break;
      case 'F1': e.preventDefault(); alternarPie(); break;
    }
  });

  input.addEventListener('input', alEscribir);

  // La ventana es más grande que el panel (margen transparente para la sombra): un clic fuera del
  // panel cuenta como clic fuera del menú.
  document.addEventListener('mousedown', (e) => { if (!panel.contains(e.target)) window.qm.close(); });

  // El ratón sigue la misma selección que el teclado; mousedown no le quita el foco al campo.
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('mousemove', (e) => {
    const row = e.target.closest('.qm-row');
    const i = flat.findIndex((f) => f.row === row);
    if (i >= 0 && i !== selIndex) {
      selIndex = i;
      selKey = flat[i].key;
      pintarSeleccion();
    }
  });
  // Los botones no le quitan el foco al campo.
  np.addEventListener('mousedown', (e) => e.preventDefault());
  more.addEventListener('mousedown', (e) => e.preventDefault());
  more.addEventListener('click', alternarPie);
  np.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) window.qm.player(b.dataset.act);
  });
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.qm-row');
    const i = flat.findIndex((f) => f.row === row);
    if (i >= 0) activar(false, i);
  });

  window.qm.onShow(alMostrar);
  window.qm.onTrack(pintarTrack);
  window.qm.onSongs(alLlegarCanciones);
}

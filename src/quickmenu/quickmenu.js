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
  const NOTE_MS = 1500;
  const NOTE_KEY = { added: 'qm.added', playingNext: 'qm.playingNext' };

  const input = document.getElementById('q');
  const list = document.getElementById('list');
  const foot = document.getElementById('foot');
  const panel = document.getElementById('qm');

  let strings = {};
  let shiftEnter = 'queue';
  let recent = [];
  let library = [];
  let songs = [];
  let songsText = '';
  let latestSeq = 0;
  let flat = [];
  let selIndex = 0;
  let selKey = null;
  let rows = new Map(); // filas ya creadas (por clave) para no recrear el DOM ni las portadas al teclear

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
    row._meta = meta;
    row._details = item.details;
    row._timer = 0;
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
    if (!escribiendo()) return [{ label: t('qm.recent'), items: normalizarTodos(recent) }];
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

  function mostrarNota(row, texto) {
    clearTimeout(row._timer);
    row._meta.textContent = texto;
    row._meta.classList.add('note');
    row._timer = setTimeout(() => {
      row._meta.textContent = row._details;
      row._meta.classList.remove('note');
    }, NOTE_MS);
  }

  function activar(shift, indice = selIndex) {
    const actual = flat[indice];
    if (!actual) return;
    const { kind, id } = actual.item;
    if (shift && kind !== 'song') return; // Mayús + Intro solo vale para canciones
    Promise.resolve(window.qm.activate({ kind, id }, shift))
      .then((res) => {
        const key = res && res.keepOpen && NOTE_KEY[res.note];
        if (key && t(key)) mostrarNota(actual.row, t(key));
      })
      .catch(() => {});
  }

  function pintarPie() {
    const hint = (tecla, texto) => {
      const s = document.createElement('span');
      const k = document.createElement('kbd');
      k.textContent = tecla;
      s.append(k, ' ' + texto);
      return s;
    };
    // qm.queueHint llega como "Mayús + Intro: a la cola": la tecla va en kbd y el resto como texto.
    const [tecla, ...resto] = t('qm.queueHint').split(':');
    const partido = Boolean(tecla) && resto.length > 0;
    const shiftTecla = partido ? tecla.trim() : 'Shift + Enter';
    const shiftTexto = shiftEnter === 'next' ? t('qm.playingNext') : (partido ? resto.join(':').trim() : t('qm.queueHint'));
    foot.replaceChildren(
      hint('↑↓', t('qm.move')),
      hint('Enter', t('qm.playOpen')),
      hint(shiftTecla, shiftTexto),
      hint('Esc', t('qm.close')),
    );
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
      render();
      return;
    }
    // Las canciones anteriores se quedan mientras la consulta nueva sea una ampliación o recorte de la
    // anterior (sin parpadeos); si cambia del todo, se quitan.
    if (songs.length && !(text.startsWith(songsText) || songsText.startsWith(text))) songs = [];
    songsText = text;
    consultar(seq, text)
      .then((res) => {
        if (!res || res.seq !== latestSeq) return;
        library = Array.isArray(res.library) ? res.library : [];
        if (Array.isArray(res.songs)) songs = res.songs;
        render();
      })
      .catch(() => {});
  }

  function alLlegarCanciones(msg) {
    if (!msg || msg.seq !== latestSeq || !escribiendo()) return; // canciones de una consulta vieja
    songs = Array.isArray(msg.songs) ? msg.songs : []; // null o error: sección oculta
    songsText = input.value;
    render();
  }

  function alMostrar(data) {
    data = data || {};
    strings = data.strings || {};
    shiftEnter = data.shiftEnter === 'next' ? 'next' : 'queue';
    recent = Array.isArray(data.recent) ? data.recent : [];
    library = [];
    songs = [];
    songsText = '';
    latestSeq++; // descarta respuestas pendientes de la vez anterior
    for (const row of rows.values()) clearTimeout(row._timer);
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
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); mover(1); break;
      case 'ArrowUp': e.preventDefault(); mover(-1); break;
      case 'Enter': e.preventDefault(); activar(e.shiftKey); break;
      case 'Escape': e.preventDefault(); window.qm.close(); break;
    }
  });

  input.addEventListener('input', alEscribir);

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
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.qm-row');
    const i = flat.findIndex((f) => f.row === row);
    if (i >= 0) activar(false, i);
  });

  window.qm.onShow(alMostrar);
  window.qm.onSongs(alLlegarCanciones);
}

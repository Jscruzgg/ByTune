// Utilidades de la biblioteca del menú rápido (playlists y álbumes). Sin dependencias.
// LibraryItem: { id: browseId ('VL…' playlist, 'MPRE…' álbum), type: 'playlist'|'album', title, artist?, cover }

// Minúsculas y sin acentos: "Más" -> "mas".
function normalize(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Hasta `limit` resultados: primero los títulos que empiezan por la consulta, luego los que la contienen.
// Dentro de cada grupo se mantiene el orden original. Consulta vacía -> [].
function filterLibrary(items, query, limit = 5) {
  const q = normalize(query).trim();
  if (!q) return [];
  const starts = [];
  const contains = [];
  for (const item of items) {
    const title = normalize(item.title);
    if (title.startsWith(q)) starts.push(item);
    else if (title.includes(q)) contains.push(item);
  }
  return starts.concat(contains).slice(0, limit);
}

// Pone el id al frente de los recientes, sin duplicados. Si ya no está en la biblioteca, no cambia nada.
function pushRecent(recent, id, libraryIds, max = 6) {
  if (!libraryIds.has(id)) return recent;
  return [id, ...recent.filter((r) => r !== id)].slice(0, max);
}

// Recientes como elementos de la biblioteca; los ids que ya no existen se saltan.
// Si no queda ninguno, se muestran los primeros de la biblioteca.
function recentItems(recent, items, limit = 6) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const found = recent.map((id) => byId.get(id)).filter(Boolean).slice(0, limit);
  return found.length ? found : items.slice(0, limit);
}

// URL de YouTube Music -> browseId: /playlist?list=X -> 'VLX', /browse/MPREb_x -> 'MPREb_x'. Otra cosa -> null.
function idFromUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname !== 'music.youtube.com') return null;
  if (u.pathname === '/playlist') {
    const list = u.searchParams.get('list');
    return list ? 'VL' + list : null;
  }
  const m = u.pathname.match(/^\/browse\/((?:MPRE|VL)[\w-]+)$/);
  return m ? m[1] : null;
}

module.exports = { filterLibrary, pushRecent, recentItems, idFromUrl };

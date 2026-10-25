// Letra de una canción: LRCLIB (sincronizada) y, si no hay, la de la página de YouTube Music.
// Sin red propia: fetchJson y pageLyrics llegan inyectados. Guarda en caché solo respuestas completas.
const { parseLrc, addGaps } = require('./lrc');
const { lookupUrls, pickSearchResult } = require('./lyrics-query');
const { createCache } = require('./cache');

const FOREVER = Number.MAX_SAFE_INTEGER; // la caché dura toda la sesión
const TOLERANCE = 3; // segundos de diferencia aceptados en un resultado de search

function createLyricsSource({ fetchJson, pageLyrics, timeoutMs = 5000, max = 100 }) {
  const cache = createCache(max, FOREVER);
  const pending = new Map();

  // Consulta LRCLIB en orden. complete = false si algo falló o no terminó con HTTP 200/404.
  async function queryLrclib(track, signal) {
    const out = { synced: null, plain: null, complete: true };
    const known = Number.isFinite(track.duration) && track.duration > 0;
    for (const url of lookupUrls(track)) {
      let res;
      try {
        res = await fetchJson(url, { signal });
      } catch {
        out.complete = false;
        if (signal.aborted) break;
        continue;
      }
      if (res.status === 404) continue;
      if (res.status !== 200) {
        out.complete = false;
        continue;
      }
      const isGet = url.includes('/api/get?');
      const record = isGet ? res.body : pickSearchResult(res.body, track.duration);
      if (!record) continue;
      // En search la sincronizada solo vale si la duración encaja; si no, solo su letra plana.
      const trusted = isGet || !known || Math.abs(record.duration - track.duration) <= TOLERANCE;
      if (trusted && record.syncedLyrics) {
        const lines = addGaps(parseLrc(record.syncedLyrics));
        if (lines.length) {
          out.synced = { kind: 'synced', lines, source: 'LRCLIB' };
          break;
        }
      }
      if (!out.plain && record.plainLyrics) out.plain = String(record.plainLyrics).split(/\r?\n/);
    }
    return out;
  }

  // Toda la fase LRCLIB tiene tope de tiempo; al vencer se aborta y se sigue con el respaldo.
  async function lrclibWithTimeout(track) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ synced: null, plain: null, complete: false });
      }, timeoutMs);
    });
    try {
      return await Promise.race([queryLrclib(track, controller.signal), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function resolveLyrics(track) {
    const lrc = await lrclibWithTimeout(track);
    if (lrc.synced) return { value: lrc.synced, cacheable: lrc.complete };
    let page;
    try {
      page = await pageLyrics(track.videoId);
    } catch {
      page = { error: 'pageLyrics failed' };
    }
    const cacheable = lrc.complete && !(page && page.error);
    if (page && page.lines && page.lines.length) {
      return { value: { kind: 'plain', lines: page.lines, source: page.source }, cacheable };
    }
    if (lrc.plain) return { value: { kind: 'plain', lines: lrc.plain, source: 'LRCLIB' }, cacheable };
    return { value: { kind: 'none' }, cacheable };
  }

  function get(track) {
    const hit = cache.get(track.videoId);
    if (hit) return Promise.resolve(hit.value);
    if (pending.has(track.videoId)) return pending.get(track.videoId);
    const p = resolveLyrics(track)
      .then(({ value, cacheable }) => {
        if (cacheable) cache.set(track.videoId, value);
        return value;
      })
      .finally(() => pending.delete(track.videoId));
    pending.set(track.videoId, p);
    return p;
  }

  return { get };
}

module.exports = { createLyricsSource };

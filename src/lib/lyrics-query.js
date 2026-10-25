// Armado de consultas a LRCLIB y elección del mejor resultado (sin red, solo texto).
const BASE = 'https://lrclib.net/api/';

// Sufijos finales entre () o [] que no son parte del nombre de la canción.
const SUFFIX = /\s*[(\[]\s*(?:(?:official\s+)?(?:music\s+video|lyric\s+video|video|audio|visualizer|mv)|(?:feat|ft)\b\.?[^)\]]*|with\s[^)\]]*)\s*[)\]]\s*$/i;

function cleanTitle(title) {
  let s = String(title || '').trim();
  let prev;
  do {
    prev = s;
    s = s.replace(SUFFIX, '').trim();
  } while (s !== prev);
  return s;
}

const ARTIST_SEP = /\s+y\s+|\s+&\s+|\s+and\s+|,\s*|\s+x\s+|\s+feat\.\s+/i;

function primaryArtist(artist) {
  return String(artist || '').split(ARTIST_SEP)[0].trim();
}

function buildUrl(endpoint, params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== '' && v != null) q.set(k, String(v));
  }
  return `${BASE}${endpoint}?${q}`;
}

function lookupUrls({ title, artist, album, duration }) {
  const hasDuration = Number.isFinite(duration) && duration > 0;
  const secs = hasDuration ? Math.round(duration) : '';
  const alb = album || '';
  // Un título que es solo un sufijo ("(Official Video)") quedaría vacío: se usa tal cual.
  const cleanT = cleanTitle(title) || title;
  const mainA = primaryArtist(artist);
  const urls = [];
  if (hasDuration) {
    urls.push(buildUrl('get', { track_name: title, artist_name: artist, album_name: alb, duration: secs }));
    if (cleanT !== title || mainA !== artist) {
      urls.push(buildUrl('get', { track_name: cleanT, artist_name: mainA, album_name: alb, duration: secs }));
    }
  }
  urls.push(buildUrl('search', { track_name: cleanT, artist_name: mainA }));
  return [...new Set(urls)];
}

function pickSearchResult(results, duration) {
  const list = Array.isArray(results) ? results : [];
  const known = Number.isFinite(duration) && duration > 0;
  const synced = list.find((r) => r && r.syncedLyrics && (!known || Math.abs(r.duration - duration) <= 3));
  if (synced) return synced;
  return list.find((r) => r && r.plainLyrics) || null;
}

module.exports = { cleanTitle, primaryArtist, lookupUrls, pickSearchResult };

// Letras sincronizadas: lee texto LRC ("[mm:ss.xx] línea") y marca pausas largas.

const STAMP = /\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const GAP_TEXT = '• • •';
const LINE_DURATION = 4; // el LRC no trae fin de línea: se asume que dura 4 s

function parseLrc(text) {
  const out = [];
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
  for (const line of lines) {
    const times = [];
    for (const m of line.matchAll(STAMP)) {
      const frac = m[3] ? parseInt(m[3], 10) / 10 ** m[3].length : 0;
      times.push(Number((parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + frac).toFixed(3)));
    }
    if (!times.length) continue; // metadatos ([ar:...]) o texto suelto
    const lyric = line.replace(STAMP, '').trim();
    for (const t of times) out.push({ t, text: lyric });
  }
  return out.sort((a, b) => a.t - b.t);
}

function addGaps(lines, { minGap = 6 } = {}) {
  // Las líneas vacías ya son una pausa: se convierten en hueco en su sitio
  const src = lines.map((l) => (l.text === '' ? { t: l.t, text: GAP_TEXT, gap: true } : l));
  const out = [];
  if (src.length && !src[0].gap && src[0].t >= minGap) {
    out.push({ t: 0, text: GAP_TEXT, gap: true });
  }
  src.forEach((line, i) => {
    out.push(line);
    const next = src[i + 1];
    if (next && !line.gap && !next.gap && next.t - line.t >= minGap + LINE_DURATION) {
      out.push({ t: line.t + LINE_DURATION, text: GAP_TEXT, gap: true });
    }
  });
  return out;
}

module.exports = { parseLrc, addGaps };

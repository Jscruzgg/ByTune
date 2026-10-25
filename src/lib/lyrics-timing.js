// Tiempos de letras sincronizadas. Sin require ni APIs de Node: el texto de este
// archivo también se antepone al script que corre dentro de la página.
const mdLyricsTiming = (() => {
  // Índice de la última línea con inicio <= t (-1 antes de la primera). Búsqueda binaria.
  function activeIndex(times, t) {
    let lo = 0;
    let hi = times.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= t) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }

  // Milisegundos hasta la siguiente línea (según la velocidad); null si no hay más.
  function msUntilNext(times, t, rate) {
    if (!(rate > 0) || !Number.isFinite(t)) return null;
    const next = activeIndex(times, t) + 1;
    if (next >= times.length) return null;
    // se redondea a 6 decimales antes del ceil para evitar ruido de coma flotante (100.00000000000009 -> 101)
    const ms = Math.round(((times[next] - t) * 1000 / rate) * 1e6) / 1e6;
    return Math.max(0, Math.ceil(ms));
  }

  return { activeIndex, msUntilNext };
})();
if (typeof module !== 'undefined') module.exports = mdLyricsTiming;

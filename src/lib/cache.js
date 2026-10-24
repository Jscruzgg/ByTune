// Caché en memoria con tope de entradas: al pasarse del tope sale la más vieja. Sin dependencias.
// Como stale-while-revalidate: get devuelve { value, fresh } y, pasado freshMs, la entrada sigue
// sirviendo (fresh: false) mientras se pide otra vez.
function createCache(max, freshMs, now = Date.now) {
  const map = new Map();
  return {
    get(key) {
      const hit = map.get(key);
      return hit && { value: hit.value, fresh: now() - hit.at <= freshMs };
    },
    set(key, value) {
      map.delete(key); // así vuelve al final del orden de inserción
      map.set(key, { value, at: now() });
      if (map.size > max) map.delete(map.keys().next().value);
    },
  };
}

module.exports = { createCache };

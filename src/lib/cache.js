// Caché en memoria con caducidad y tope de entradas: al pasarse del tope sale la más vieja. Sin dependencias.
function createCache(max, ttlMs, now = Date.now) {
  const map = new Map();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return undefined;
      if (now() - hit.at > ttlMs) {
        map.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key, value) {
      map.delete(key); // así vuelve al final del orden de inserción
      map.set(key, { value, at: now() });
      if (map.size > max) map.delete(map.keys().next().value);
    },
  };
}

module.exports = { createCache };

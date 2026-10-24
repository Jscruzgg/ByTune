const test = require('node:test');
const assert = require('node:assert/strict');
const { createCache } = require('../src/lib/cache');

test('pasado el tiempo, lo guardado sigue ahí pero ya no está fresco', () => {
  let ahora = 0;
  const cache = createCache(10, 100, () => ahora);
  assert.equal(cache.get('a'), undefined);
  cache.set('a', [1]);
  ahora = 100;
  assert.deepEqual(cache.get('a'), { value: [1], fresh: true });
  ahora = 101;
  assert.deepEqual(cache.get('a'), { value: [1], fresh: false });
  cache.set('a', [2]); // al volver a pedirlo, fresco otra vez
  assert.deepEqual(cache.get('a'), { value: [2], fresh: true });
});

test('al pasarse del tope sale la entrada más vieja', () => {
  const cache = createCache(2, 1000);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('a', 3); // reescribir la renueva
  cache.set('c', 4);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a').value, 3);
  assert.equal(cache.get('c').value, 4);
});

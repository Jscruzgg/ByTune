const test = require('node:test');
const assert = require('node:assert/strict');
const { createCache } = require('../src/lib/cache');

test('devuelve lo guardado hasta que caduca', () => {
  let ahora = 0;
  const cache = createCache(10, 100, () => ahora);
  cache.set('a', [1]);
  ahora = 100;
  assert.deepEqual(cache.get('a'), [1]);
  ahora = 101;
  assert.equal(cache.get('a'), undefined);
});

test('al pasarse del tope sale la entrada más vieja', () => {
  const cache = createCache(2, 1000);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('a', 3); // reescribir la renueva
  cache.set('c', 4);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), 3);
  assert.equal(cache.get('c'), 4);
});

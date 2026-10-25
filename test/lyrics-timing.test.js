const test = require('node:test');
const assert = require('node:assert/strict');
const timing = require('../src/lib/lyrics-timing');

const times = [0, 3, 6.5, 10];

test('activeIndex devuelve la última línea cuyo inicio ya pasó', () => {
  assert.equal(timing.activeIndex(times, -1), -1);
  assert.equal(timing.activeIndex(times, 0), 0);
  assert.equal(timing.activeIndex(times, 2.999), 0);
  assert.equal(timing.activeIndex(times, 3), 1);
  assert.equal(timing.activeIndex(times, 99), 3);
  assert.equal(timing.activeIndex([], 5), -1);
});

test('msUntilNext calcula los ms hasta la siguiente línea según la velocidad', () => {
  assert.equal(timing.msUntilNext(times, 2, 1), 1000);
  assert.equal(timing.msUntilNext(times, 2, 2), 500);
  assert.equal(timing.msUntilNext(times, 10, 1), null);
  assert.equal(timing.msUntilNext(times, -0.5, 1), 500);
  assert.equal(timing.msUntilNext(times, 2, 0), null);
  assert.equal(timing.msUntilNext(times, NaN, 1), null);
  assert.equal(timing.msUntilNext([0, 3], 2.9, 1), 100);
  assert.equal(timing.msUntilNext(times, 3, 1), 3500);
});

test('el módulo exporta ambas funciones con require', () => {
  assert.equal(typeof timing.activeIndex, 'function');
  assert.equal(typeof timing.msUntilNext, 'function');
});

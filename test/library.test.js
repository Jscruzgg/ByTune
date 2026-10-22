const test = require('node:test');
const assert = require('node:assert/strict');
const { filterLibrary, pushRecent, recentItems, idFromUrl } = require('../src/lib/library');

const items = [
  { id: 'VLa', type: 'playlist', title: 'Chill Sunday', cover: 'a.jpg' },
  { id: 'VLb', type: 'playlist', title: 'Más chill', cover: 'b.jpg' },
  { id: 'MPREc', type: 'album', title: 'Chill Vibes', artist: 'X', cover: 'c.jpg' },
  { id: 'VLd', type: 'playlist', title: 'Focus', cover: 'd.jpg' },
];

test('filterLibrary: empiezan por la consulta primero, luego los que la contienen', () => {
  assert.deepEqual(filterLibrary(items, 'chill').map((i) => i.title), ['Chill Sunday', 'Chill Vibes', 'Más chill']);
});

test('filterLibrary: ignora acentos y mayúsculas', () => {
  assert.deepEqual(filterLibrary(items, 'mas').map((i) => i.title), ['Más chill']);
  assert.deepEqual(filterLibrary(items, 'MÁS').map((i) => i.title), ['Más chill']);
});

test('filterLibrary: consulta vacía devuelve []', () => {
  assert.deepEqual(filterLibrary(items, ''), []);
  assert.deepEqual(filterLibrary(items, '   '), []);
});

test('filterLibrary: respeta el límite', () => {
  assert.equal(filterLibrary(items, 'chill', 2).length, 2);
});

test('pushRecent: mueve al frente sin duplicar', () => {
  assert.deepEqual(pushRecent(['b', 'a'], 'a', new Set(['a', 'b'])), ['a', 'b']);
});

test('pushRecent: ignora ids que no están en la biblioteca', () => {
  assert.deepEqual(pushRecent(['a'], 'x', new Set(['a'])), ['a']);
});

test('pushRecent: recorta al máximo', () => {
  const ids = new Set(['1', '2', '3', '4', '5', '6', '7']);
  const out = pushRecent(['1', '2', '3', '4', '5', '6'], '7', ids);
  assert.equal(out.length, 6);
  assert.equal(out[0], '7');
});

test('recentItems: salta ids que ya no existen (Review Focus 5)', () => {
  const out = recentItems(['gone', 'VLa'], items);
  assert.deepEqual(out.map((i) => i.id), ['VLa']);
});

test('recentItems: sin recientes usa los primeros de la biblioteca', () => {
  assert.deepEqual(recentItems([], items, 2), items.slice(0, 2));
  assert.deepEqual(recentItems(['gone'], items, 2), items.slice(0, 2));
});

test('idFromUrl', () => {
  assert.equal(idFromUrl('https://music.youtube.com/playlist?list=PL1'), 'VLPL1');
  assert.equal(idFromUrl('https://music.youtube.com/browse/MPREb_x'), 'MPREb_x');
  assert.equal(idFromUrl('https://music.youtube.com/'), null);
  assert.equal(idFromUrl('https://music.youtube.com/watch?v=abc'), null);
  assert.equal(idFromUrl('no es una url'), null);
  assert.equal(idFromUrl(undefined), null);
});

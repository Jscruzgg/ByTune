const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanTitle, primaryArtist, lookupUrls, pickSearchResult } = require('../src/lib/lyrics-query');

test('cleanTitle quita sufijos de video y colaboraciones', () => {
  assert.equal(cleanTitle('Song (Official Video)'), 'Song');
  assert.equal(cleanTitle('Song [Official Audio]'), 'Song');
  assert.equal(cleanTitle('Song (lyric video)'), 'Song');
  assert.equal(cleanTitle('Song (feat. B)'), 'Song');
  assert.equal(cleanTitle('Song (ft. B)'), 'Song');
  assert.equal(cleanTitle('Song (with B)'), 'Song');
});

test('cleanTitle deja los paréntesis que son parte del nombre', () => {
  assert.equal(cleanTitle('MEEEEEE (NAYEON)'), 'MEEEEEE (NAYEON)');
});

test('primaryArtist devuelve el primer nombre', () => {
  assert.equal(primaryArtist('TWICE y NAYEON'), 'TWICE');
  assert.equal(primaryArtist('A, B & C'), 'A');
  assert.equal(primaryArtist('A feat. B'), 'A');
  assert.equal(primaryArtist('Solo'), 'Solo');
});

test('lookupUrls arma get crudo, get limpio y search', () => {
  const urls = lookupUrls({ title: 'R&B #1 / 사랑', artist: 'A & B', album: '', duration: 165.6 });
  assert.ok(urls[0].startsWith('https://lrclib.net/api/get?'));
  assert.ok(urls[0].includes('track_name=R%26B+%231+%2F+%EC%82%AC%EB%9E%91'));
  assert.ok(urls[0].includes('duration=166'));
  assert.ok(!urls[0].includes('album_name'));
  assert.ok(urls[1].includes('artist_name=A&'));
  assert.ok(urls[2].startsWith('https://lrclib.net/api/search?'));
  assert.equal(urls.length, 3);
});

test('lookupUrls incluye álbum y evita duplicados', () => {
  const urls = lookupUrls({ title: 'Song', artist: 'Solo', album: 'Alb', duration: 100 });
  assert.equal(urls.length, 2);
  assert.ok(urls[0].includes('album_name=Alb'));
  assert.ok(urls[1].startsWith('https://lrclib.net/api/search?'));
});

test('lookupUrls sin duración válida solo busca', () => {
  for (const duration of [NaN, 0, -1, undefined]) {
    const urls = lookupUrls({ title: 'R&B', artist: 'A & B', album: 'X', duration });
    assert.equal(urls.length, 1);
    assert.ok(urls[0].startsWith('https://lrclib.net/api/search?'));
  }
});

test('pickSearchResult prefiere sincronizada con duración cercana', () => {
  const a = { duration: 170, syncedLyrics: 'x' };
  const b = { duration: 166, syncedLyrics: 'y' };
  assert.equal(pickSearchResult([a, b], 165), b);
});

test('pickSearchResult sin duración toma la primera sincronizada', () => {
  const a = { duration: 170, syncedLyrics: 'x' };
  assert.equal(pickSearchResult([{ duration: 1, syncedLyrics: '' }, a], NaN), a);
});

test('pickSearchResult cae a letra plana y luego a null', () => {
  const p1 = { duration: 1, syncedLyrics: null, plainLyrics: 'a' };
  const p2 = { duration: 1, syncedLyrics: null, plainLyrics: 'b' };
  assert.equal(pickSearchResult([p1, p2], 165), p1);
  assert.equal(pickSearchResult([], 165), null);
  assert.equal(pickSearchResult([{ syncedLyrics: null, plainLyrics: '' }], 165), null);
});

test('lookupUrls: un título que es solo un sufijo se busca tal cual', () => {
  const urls = lookupUrls({ title: '(Official Video)', artist: 'A', album: '', duration: NaN });
  assert.equal(urls.length, 1);
  assert.ok(urls[0].includes('track_name=%28Official+Video%29'));
});

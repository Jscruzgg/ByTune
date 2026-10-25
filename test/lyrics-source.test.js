const test = require('node:test');
const assert = require('node:assert/strict');
const { createLyricsSource } = require('../src/lib/lyrics-source');

const track = { videoId: 'v1', title: 'Canción', artist: 'Artista', album: 'Álbum', duration: 165 };
const LRC = '[00:01.00]hola\n[00:05.00]mundo';
const isGet = (url) => url.includes('/api/get?');

// fetchJson falso: responde según la ruta (get/search) y cuenta llamadas.
function fakes({ get = { status: 404 }, search = { status: 200, body: [] }, page = { none: true } } = {}) {
  const calls = { fetch: [], page: 0 };
  return {
    calls,
    fetchJson: async (url) => {
      calls.fetch.push(url);
      return isGet(url) ? get : search;
    },
    pageLyrics: async () => {
      calls.page++;
      return page;
    },
  };
}

test('sincronizada en el primer get: no consulta la página', async () => {
  const f = fakes({ get: { status: 200, body: { syncedLyrics: LRC, plainLyrics: 'x' } } });
  const res = await createLyricsSource(f).get(track);
  assert.equal(res.kind, 'synced');
  assert.equal(res.source, 'LRCLIB');
  assert.deepEqual(res.lines.map((l) => [l.t, l.text]), [[1, 'hola'], [5, 'mundo']]);
  assert.equal(f.calls.page, 0);
});

test('get 404 y search con sincronizada dentro de 3 s: sincronizada', async () => {
  const f = fakes({ search: { status: 200, body: [{ duration: 167, syncedLyrics: LRC }] } });
  const res = await createLyricsSource(f).get(track);
  assert.equal(res.kind, 'synced');
  assert.equal(f.calls.page, 0);
});

test('sin sincronizada: usa la letra plana de la página', async () => {
  const f = fakes({ page: { lines: ['a', 'b'], source: 'Fuente: LyricFind' } });
  const res = await createLyricsSource(f).get(track);
  assert.deepEqual(res, { kind: 'plain', lines: ['a', 'b'], source: 'Fuente: LyricFind' });
});

test('sin sincronizada ni página: usa plainLyrics de LRCLIB', async () => {
  const f = fakes({ search: { status: 200, body: [{ duration: 165, plainLyrics: 'x\ny' }] } });
  const res = await createLyricsSource(f).get(track);
  assert.deepEqual(res, { kind: 'plain', lines: ['x', 'y'], source: 'LRCLIB' });
});

test('search con sincronizada de otra duración no cuenta como sincronizada', async () => {
  const f = fakes({ search: { status: 200, body: [{ duration: 200, syncedLyrics: LRC, plainLyrics: 'x\ny' }] } });
  const res = await createLyricsSource(f).get(track);
  assert.deepEqual(res, { kind: 'plain', lines: ['x', 'y'], source: 'LRCLIB' });
});

test('search con sincronizada de otra duración y sin plana: ninguna', async () => {
  const f = fakes({ search: { status: 200, body: [{ duration: 200, syncedLyrics: LRC }] } });
  const res = await createLyricsSource(f).get(track);
  assert.deepEqual(res, { kind: 'none' });
});

test('sincronizada que no se puede leer cuenta como fallo', async () => {
  const f = fakes({ get: { status: 200, body: { syncedLyrics: 'sin marcas', plainLyrics: 'x' } } });
  const res = await createLyricsSource(f).get(track);
  assert.deepEqual(res, { kind: 'plain', lines: ['x'], source: 'LRCLIB' });
});

test('nada en ningún lado: none y el segundo get sale de la caché', async () => {
  const f = fakes();
  const src = createLyricsSource(f);
  assert.deepEqual(await src.get(track), { kind: 'none' });
  const fetches = f.calls.fetch.length;
  assert.deepEqual(await src.get(track), { kind: 'none' });
  assert.equal(f.calls.fetch.length, fetches);
  assert.equal(f.calls.page, 1);
});

test('sin red: usa la página y no se guarda en caché', async () => {
  const f = fakes({ page: { lines: ['a'], source: 'Fuente: X' } });
  f.fetchJson = async (url) => {
    f.calls.fetch.push(url);
    throw new Error('offline');
  };
  const src = createLyricsSource(f);
  assert.equal((await src.get(track)).kind, 'plain');
  const fetches = f.calls.fetch.length;
  await src.get(track);
  assert.ok(f.calls.fetch.length > fetches);
});

test('error de la página no se guarda en caché', async () => {
  const f = fakes({ page: { error: 'boom' } });
  const src = createLyricsSource(f);
  assert.deepEqual(await src.get(track), { kind: 'none' });
  await src.get(track);
  assert.equal(f.calls.page, 2);
});

test('estado HTTP inesperado (500) no se guarda en caché', async () => {
  const f = fakes({ search: { status: 500, body: null } });
  const src = createLyricsSource(f);
  await src.get(track);
  const fetches = f.calls.fetch.length;
  await src.get(track);
  assert.ok(f.calls.fetch.length > fetches);
});

test('fetchJson colgado: tras timeoutMs aborta y cae a la página', async () => {
  const f = fakes({ page: { lines: ['a'], source: 'Fuente: X' } });
  const signals = [];
  f.fetchJson = (url, { signal }) => {
    signals.push(signal);
    return new Promise(() => {});
  };
  const res = await createLyricsSource({ ...f, timeoutMs: 20 }).get(track);
  assert.equal(res.kind, 'plain');
  assert.equal(signals[0].aborted, true);
});

test('dos get simultáneos del mismo videoId comparten las consultas', async () => {
  const f = fakes({ get: { status: 200, body: { syncedLyrics: LRC } } });
  const src = createLyricsSource(f);
  const [a, b] = await Promise.all([src.get(track), src.get(track)]);
  assert.equal(f.calls.fetch.length, 1);
  assert.deepEqual(a, b);
});

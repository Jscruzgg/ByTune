const test = require('node:test');
const assert = require('node:assert/strict');
const { latestOnly } = require('../src/quickmenu/quickmenu');

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

test('drops stale results', async () => {
  const tarda = { a: 30, ab: 5 };
  const wrapped = latestOnly(async (text) => {
    await espera(tarda[text]);
    return text;
  });
  const entregados = [];
  const entrega = (p) => p.then((r) => { if (r !== undefined) entregados.push(r); });
  await Promise.all([entrega(wrapped('a')), entrega(wrapped('ab'))]);
  assert.deepEqual(entregados, ['ab']);
});

test('una llamada sola entrega su resultado', async () => {
  const wrapped = latestOnly(async (x) => x * 2);
  assert.equal(await wrapped(4), 8);
});

test('un error de una llamada obsoleta se ignora; el de la última se propaga', async () => {
  const wrapped = latestOnly(async (text) => {
    await espera(text === 'a' ? 5 : 15);
    throw new Error(text);
  });
  const a = wrapped('a');
  const ab = wrapped('ab');
  assert.equal(await a, undefined);
  await assert.rejects(ab, /ab/);
});

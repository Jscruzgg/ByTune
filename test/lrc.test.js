const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLrc, addGaps } = require('../src/lib/lrc');

const GAP = '• • •';

test('parseLrc lee minutos, segundos y centésimas', () => {
  assert.deepEqual(parseLrc('[00:12.34]Hola\n[01:02]Adiós'), [
    { t: 12.34, text: 'Hola' },
    { t: 62, text: 'Adiós' },
  ]);
});

test('parseLrc escala la fracción de 3 dígitos como milésimas', () => {
  assert.equal(parseLrc('[00:01.500]a')[0].t, 1.5);
});

test('parseLrc: varias marcas en una línea dan varias entradas', () => {
  assert.deepEqual(parseLrc('[00:05.00][00:20.00]Coro'), [
    { t: 5, text: 'Coro' },
    { t: 20, text: 'Coro' },
  ]);
});

test('parseLrc ignora las etiquetas de metadatos', () => {
  const out = parseLrc('[ar:X]\n[ti:Y]\n[length:03:00]\n[00:01.00]a');
  assert.deepEqual(out, [{ t: 1, text: 'a' }]);
});

test('parseLrc acepta CRLF y BOM al inicio', () => {
  const out = parseLrc('﻿[00:01.00]a\r\n[00:02.00]b\r\n');
  assert.deepEqual(out.map((l) => l.text), ['a', 'b']);
});

test('parseLrc ordena por tiempo y recorta el texto', () => {
  const out = parseLrc('[00:10.00]  segunda  \n[00:02.00]primera');
  assert.deepEqual(out, [
    { t: 2, text: 'primera' },
    { t: 10, text: 'segunda' },
  ]);
});

test('parseLrc conserva la línea con tiempo y sin texto', () => {
  assert.deepEqual(parseLrc('[00:03.00]'), [{ t: 3, text: '' }]);
});

test('addGaps inserta un hueco cuando la pausa es larga', () => {
  const out = addGaps([
    { t: 0.5, text: 'a' },
    { t: 3, text: 'b' },
    { t: 13, text: 'c' },
  ]);
  assert.deepEqual(out, [
    { t: 0.5, text: 'a' },
    { t: 3, text: 'b' },
    { t: 7, text: GAP, gap: true },
    { t: 13, text: 'c' },
  ]);
});

test('addGaps no toca pausas por debajo del mínimo', () => {
  const lines = [
    { t: 0.5, text: 'a' },
    { t: 3, text: 'b' },
    { t: 10, text: 'c' },
  ];
  assert.deepEqual(addGaps(lines), lines);
});

test('addGaps: justo por debajo del límite (9.9 s) no inserta hueco', () => {
  const lines = [
    { t: 3, text: 'b' },
    { t: 12.9, text: 'c' },
  ];
  assert.deepEqual(addGaps(lines), lines);
});

test('addGaps pone un hueco al inicio si la primera línea tarda', () => {
  assert.deepEqual(addGaps([{ t: 8, text: 'a' }])[0], { t: 0, text: GAP, gap: true });
  assert.deepEqual(addGaps([{ t: 3, text: 'a' }]), [{ t: 3, text: 'a' }]);
});

test('addGaps convierte una línea vacía en hueco, sin duplicar', () => {
  const out = addGaps([
    { t: 0, text: 'a' },
    { t: 5, text: '' },
    { t: 20, text: 'b' },
  ]);
  assert.deepEqual(out, [
    { t: 0, text: 'a' },
    { t: 5, text: GAP, gap: true },
    { t: 20, text: 'b' },
  ]);
});

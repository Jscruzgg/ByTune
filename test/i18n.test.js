const test = require('node:test');
const assert = require('node:assert');
const { pickLang, t, STRINGS } = require('../src/lib/i18n');

test('pickLang: es* → es, everything else → en', () => {
  assert.equal(pickLang('es'), 'es');
  assert.equal(pickLang('es-419'), 'es');
  assert.equal(pickLang('ES-es'), 'es');
  assert.equal(pickLang('en-GB'), 'en');
  assert.equal(pickLang('pt-BR'), 'en');
  assert.equal(pickLang(null), 'en');
  assert.equal(pickLang(''), 'en');
});
test('both languages define exactly the same keys', () => {
  assert.deepEqual(Object.keys(STRINGS.es).sort(), Object.keys(STRINGS.en).sort());
});
test('t: fills placeholders and falls back', () => {
  assert.equal(t('es', 'tray.next'), 'Siguiente');
  assert.equal(t('en', 'tray.next'), 'Next');
  assert.equal(t('es', 'no.such.key'), 'no.such.key');
});
test('t: reemplaza {marcadores} y deja los desconocidos', () => {
  STRINGS.en['x.hello'] = 'Hi {name} {other}';
  try {
    assert.equal(t('en', 'x.hello', { name: 'Ana' }), 'Hi Ana {other}');
    assert.equal(t('es', 'x.hello', { name: 'Ana', other: '!' }), 'Hi Ana !'); // cae a inglés
  } finally { delete STRINGS.en['x.hello']; }
});

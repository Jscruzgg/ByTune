const test = require('node:test');
const assert = require('node:assert/strict');
const { RESERVED, fromKeyEvent, validateAccelerator, matches, displayAccelerator } = require('../src/lib/shortcut');

test('fromKeyEvent: evento DOM con Ctrl+Mayús+Espacio', () => {
  assert.equal(fromKeyEvent({ key: ' ', ctrlKey: true, shiftKey: true }), 'CommandOrControl+Shift+Space');
});

test('fromKeyEvent: entrada de Electron (control/alt) y letra en mayúscula', () => {
  assert.equal(fromKeyEvent({ key: 'k', control: true, alt: true }), 'CommandOrControl+Alt+K');
});

test('fromKeyEvent: orden fijo de modificadores y Super', () => {
  assert.equal(
    fromKeyEvent({ key: 'a', metaKey: true, shiftKey: true, altKey: true, ctrlKey: true }),
    'CommandOrControl+Alt+Shift+Super+A'
  );
  assert.equal(fromKeyEvent({ key: 'a', meta: true }), 'Super+A');
});

test('fromKeyEvent: solo modificadores devuelve null', () => {
  assert.equal(fromKeyEvent({ key: 'Shift', shiftKey: true }), null);
  assert.equal(fromKeyEvent({ key: 'Control', ctrlKey: true }), null);
  assert.equal(fromKeyEvent({ key: 'Meta', metaKey: true }), null);
  assert.equal(fromKeyEvent({ key: 'Alt', altKey: true }), null);
});

test('fromKeyEvent: flechas y otras teclas', () => {
  assert.equal(fromKeyEvent({ key: 'ArrowUp', ctrlKey: true }), 'CommandOrControl+Up');
  assert.equal(fromKeyEvent({ key: 'ArrowDown', ctrlKey: true }), 'CommandOrControl+Down');
  assert.equal(fromKeyEvent({ key: 'ArrowLeft', alt: true }), 'Alt+Left');
  assert.equal(fromKeyEvent({ key: 'ArrowRight', alt: true }), 'Alt+Right');
  assert.equal(fromKeyEvent({ key: 'F5', shiftKey: true }), 'Shift+F5');
  assert.equal(fromKeyEvent({ key: '7', ctrlKey: true }), 'CommandOrControl+7');
  assert.equal(fromKeyEvent({ key: 'Enter', ctrlKey: true }), 'CommandOrControl+Enter');
});

test('fromKeyEvent: entrada inválida devuelve null', () => {
  assert.equal(fromKeyEvent(null), null);
  assert.equal(fromKeyEvent({}), null);
});

test('validateAccelerator', () => {
  assert.deepEqual(validateAccelerator('Space'), { ok: false, reason: 'invalid' });
  assert.deepEqual(validateAccelerator('CommandOrControl'), { ok: false, reason: 'invalid' });
  assert.deepEqual(validateAccelerator(null), { ok: false, reason: 'invalid' });
  assert.deepEqual(validateAccelerator(''), { ok: false, reason: 'invalid' });
  assert.deepEqual(validateAccelerator('CommandOrControl+Alt+M'), { ok: false, reason: 'reserved' });
  assert.deepEqual(validateAccelerator('CommandOrControl+Shift+Space'), { ok: true });
});

test('validateAccelerator: rechaza los cuatro atajos globales existentes', () => {
  assert.equal(RESERVED.length, 4);
  for (const acc of RESERVED) assert.deepEqual(validateAccelerator(acc), { ok: false, reason: 'reserved' });
});

test('displayAccelerator', () => {
  assert.equal(displayAccelerator('CommandOrControl+Shift+Space'), 'Ctrl + Shift + Space');
  assert.equal(displayAccelerator('Super+Alt+K'), 'Win + Alt + K');
});

test('matches', () => {
  assert.equal(matches({ key: ' ', control: true, shift: true }, 'CommandOrControl+Shift+Space'), true);
  assert.equal(matches({ key: ' ', control: true }, 'CommandOrControl+Shift+Space'), false);
});

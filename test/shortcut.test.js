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

test('fromKeyEvent: prefiere code a key (teclado español, Mayús+3 llega como "·")', () => {
  assert.equal(fromKeyEvent({ key: '·', code: 'Digit3', ctrlKey: true, shiftKey: true }), 'CommandOrControl+Shift+3');
  assert.equal(fromKeyEvent({ key: 'k', code: 'KeyK', control: true }), 'CommandOrControl+K');
  assert.equal(fromKeyEvent({ key: ' ', code: 'Space', control: true }), 'CommandOrControl+Space');
  assert.equal(fromKeyEvent({ key: 'ArrowLeft', code: 'ArrowLeft', alt: true }), 'Alt+Left');
  assert.equal(fromKeyEvent({ key: 'F12', code: 'F12', alt: true }), 'Alt+F12');
  assert.equal(fromKeyEvent({ key: 'ñ', code: 'Semicolon', ctrlKey: true }), 'CommandOrControl+;');
  assert.equal(fromKeyEvent({ key: '1', code: 'Numpad1', ctrlKey: true }), 'CommandOrControl+num1');
});

test('fromKeyEvent: la tecla + se llama Plus', () => {
  assert.equal(fromKeyEvent({ key: '+', ctrlKey: true }), 'CommandOrControl+Plus');
  assert.equal(fromKeyEvent({ key: '+', code: 'Equal', ctrlKey: true, shiftKey: true }), 'CommandOrControl+Shift+=');
  assert.equal(displayAccelerator('CommandOrControl+Plus'), 'Ctrl + +');
});

test('validateAccelerator: rechaza teclas que Electron no puede registrar', () => {
  const invalid = { ok: false, reason: 'invalid' };
  assert.deepEqual(validateAccelerator(fromKeyEvent({ key: 'ñ', ctrlKey: true, altKey: true })), invalid);
  assert.deepEqual(validateAccelerator('CommandOrControl+Alt+Ñ'), invalid);
  assert.deepEqual(validateAccelerator('Alt+Dead'), invalid);
  assert.deepEqual(validateAccelerator(fromKeyEvent({ key: 'Dead', alt: true })), invalid);
  assert.deepEqual(validateAccelerator('Alt+SS'), invalid);
  for (const key of ['ContextMenu', 'Process', 'Unidentified', 'NumLock', 'ScrollLock']) {
    assert.deepEqual(validateAccelerator('Alt+' + key), invalid, key);
  }
});

test('validateAccelerator: acepta teclas válidas de Electron', () => {
  for (const acc of ['Alt+A', 'Alt+7', 'Alt+F24', 'Alt+Up', 'Shift+Enter', 'Alt+Plus', 'Alt+;', 'Alt+num3', 'Super+Space']) {
    assert.deepEqual(validateAccelerator(acc), { ok: true }, acc);
  }
  assert.deepEqual(validateAccelerator('Alt+F25'), { ok: false, reason: 'invalid' });
});

test('validateAccelerator: terminar en + es inválido', () => {
  assert.deepEqual(validateAccelerator('CommandOrControl+'), { ok: false, reason: 'invalid' });
  assert.deepEqual(validateAccelerator('CommandOrControl++'), { ok: false, reason: 'invalid' });
});

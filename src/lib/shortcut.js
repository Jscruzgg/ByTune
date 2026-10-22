// Utilidades para atajos de teclado (aceleradores de Electron). Sin dependencias: lo usa main.js
// con los objetos de 'before-input-event' y también acepta KeyboardEvent del DOM.

// Los cuatro atajos globales que ya existen: el atajo del menú rápido no puede coincidir con ellos.
const RESERVED = [
  'CommandOrControl+Alt+Space',
  'CommandOrControl+Alt+Right',
  'CommandOrControl+Alt+Left',
  'CommandOrControl+Alt+M',
];

const MODIFIERS = ['CommandOrControl', 'Alt', 'Shift', 'Super'];
// Teclas que por sí solas no cuentan como tecla principal del atajo.
const MODIFIER_KEYS = new Set(['Control', 'Alt', 'AltGraph', 'Shift', 'Meta', 'OS', 'Super', 'CapsLock']);
const KEY_NAMES = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };

// Convierte un evento (DOM: ctrlKey/altKey/shiftKey/metaKey; Electron: control/alt/shift/meta)
// en un acelerador con orden fijo de modificadores. Devuelve null si solo hay modificadores.
function fromKeyEvent(e) {
  if (!e || typeof e.key !== 'string' || e.key === '' || MODIFIER_KEYS.has(e.key)) return null;
  const key = KEY_NAMES[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  const parts = [];
  if (e.ctrlKey || e.control) parts.push('CommandOrControl');
  if (e.altKey || e.alt) parts.push('Alt');
  if (e.shiftKey || e.shift) parts.push('Shift');
  if (e.metaKey || e.meta) parts.push('Super');
  parts.push(key);
  return parts.join('+');
}

// Separa un acelerador en modificadores y tecla. La propia tecla "+" ('Ctrl++') se conserva.
function splitAccelerator(acc) {
  const key = acc.endsWith('+') ? '+' : acc.split('+').pop();
  const rest = acc.slice(0, acc.length - key.length).replace(/\+$/, '');
  return { mods: rest ? rest.split('+') : [], key };
}

// Debe tener al menos un modificador y una tecla, y no puede ser uno de los atajos ya usados.
function validateAccelerator(acc) {
  if (typeof acc !== 'string' || !acc) return { ok: false, reason: 'invalid' };
  const { mods, key } = splitAccelerator(acc);
  if (!key || MODIFIERS.includes(key) || mods.length === 0 || !mods.every((m) => MODIFIERS.includes(m))) {
    return { ok: false, reason: 'invalid' };
  }
  if (RESERVED.includes(acc)) return { ok: false, reason: 'reserved' };
  return { ok: true };
}

function matches(input, acc) {
  return fromKeyEvent(input) === acc;
}

// Texto legible para mostrar en los ajustes: 'CommandOrControl+Shift+Space' -> 'Ctrl + Shift + Space'.
function displayAccelerator(acc) {
  if (typeof acc !== 'string' || !acc) return '';
  const { mods, key } = splitAccelerator(acc);
  const names = { CommandOrControl: 'Ctrl', Super: 'Win' };
  return [...mods.map((m) => names[m] ?? m), key].join(' + ');
}

module.exports = { RESERVED, fromKeyEvent, validateAccelerator, matches, displayAccelerator };

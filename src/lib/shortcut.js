// Utilidades para atajos de teclado (aceleradores de Electron). Sin dependencias: lo usa main.js
// con los objetos de 'before-input-event' y también acepta KeyboardEvent del DOM.

// Los atajos globales que ya existen: el atajo del menú rápido no puede coincidir con ellos.
const RESERVED = [
  'CommandOrControl+Alt+Right',
  'CommandOrControl+Alt+Left',
  'CommandOrControl+Alt+M',
];

const MODIFIERS = ['CommandOrControl', 'Alt', 'Shift', 'Super'];
// Teclas que por sí solas no cuentan como tecla principal del atajo.
const MODIFIER_KEYS = new Set(['Control', 'Alt', 'AltGraph', 'Shift', 'Meta', 'OS', 'Super', 'CapsLock']);
const KEY_NAMES = {
  ' ': 'Space', '+': 'Plus', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
};

// Teclas por `code` (independiente de la distribución del teclado y de Mayús). Con teclado español,
// Mayús+3 llega como key '·' pero code 'Digit3'; la ñ llega como code 'Semicolon'.
const CODE_NAMES = {
  Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete',
  Insert: 'Insert', Escape: 'Escape', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', PrintScreen: 'PrintScreen',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',Semicolon: ';',
  Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
  NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec',
};

function keyFromCode(code) {
  if (typeof code !== 'string' || !code) return null;
  let m;
  if ((m = code.match(/^Key([A-Z])$/))) return m[1];
  if ((m = code.match(/^Digit(\d)$/))) return m[1];
  if ((m = code.match(/^Numpad(\d)$/))) return 'num' + m[1];
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  return CODE_NAMES[code] ?? null;
}

// Teclas principales que Electron sabe registrar con globalShortcut.
const NAMED_KEYS = new Set([
  'Space', 'Plus', 'Enter', 'Return', 'Tab', 'Backspace', 'Delete', 'Insert', 'Escape', 'Esc', 'Home', 'End',
  'PageUp', 'PageDown', 'Up', 'Down', 'Left', 'Right', 'PrintScreen', 'VolumeUp', 'VolumeDown', 'VolumeMute',
  'MediaNextTrack', 'MediaPreviousTrack', 'MediaStop', 'MediaPlayPause',
  'numadd', 'numsub', 'nummult', 'numdiv', 'numdec',
]);

function isValidKey(key) {
  return (
    /^[A-Z0-9]$/.test(key) ||
    /^F([1-9]|1\d|2[0-4])$/.test(key) ||
    /^num\d$/.test(key) ||
    NAMED_KEYS.has(key) ||
    /^[!-*,-/:-@[-`{-~]$/.test(key) // puntuación ASCII, sin el '+' (se llama Plus)
  );
}

// Convierte un evento (DOM: ctrlKey/altKey/shiftKey/metaKey; Electron: control/alt/shift/meta)
// en un acelerador con orden fijo de modificadores. Devuelve null si solo hay modificadores.
// Prefiere `code` (si existe) para la tecla; si no, usa `key`. Las teclas que Electron no puede
// registrar (ñ, teclas muertas…) se devuelven tal cual y validateAccelerator las rechaza.
function fromKeyEvent(e) {
  if (!e || typeof e.key !== 'string' || e.key === '' || MODIFIER_KEYS.has(e.key)) return null;
  const key =
    keyFromCode(e.code) ?? KEY_NAMES[e.key] ?? (/^[a-z]$/i.test(e.key) ? e.key.toUpperCase() : e.key);
  const parts = [];
  if (e.ctrlKey || e.control) parts.push('CommandOrControl');
  if (e.altKey || e.alt) parts.push('Alt');
  if (e.shiftKey || e.shift) parts.push('Shift');
  if (e.metaKey || e.meta) parts.push('Super');
  parts.push(key);
  return parts.join('+');
}

// Separa un acelerador en modificadores y tecla (la última parte). Una parte vacía lo invalida
// ('CommandOrControl+' o 'CommandOrControl++': el '+' como tecla se escribe Plus).
function splitAccelerator(acc) {
  const parts = acc.split('+');
  return { mods: parts.slice(0, -1), key: parts[parts.length - 1], empty: parts.includes('') };
}

// Debe tener al menos un modificador y una tecla, y no puede ser uno de los atajos ya usados.
function validateAccelerator(acc) {
  if (typeof acc !== 'string' || !acc) return { ok: false, reason: 'invalid' };
  const { mods, key, empty } = splitAccelerator(acc);
  if (empty || !isValidKey(key) || mods.length === 0 || !mods.every((m) => MODIFIERS.includes(m))) {
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
  const names = { CommandOrControl: 'Ctrl', Super: 'Win', Plus: '+' };
  return [...mods, key].map((m) => names[m] ?? m).join(' + ');
}

module.exports = { RESERVED, fromKeyEvent, validateAccelerator, matches, displayAccelerator };

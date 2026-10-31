const test = require('node:test');
const assert = require('node:assert/strict');
const palette = require('../src/lib/palette');

// Imagen de prueba: n píxeles RGBA de los colores dados (cada uno [r, g, b, veces]).
function img(...parts) {
  const out = [];
  for (const [r, g, b, times] of parts) for (let i = 0; i < times; i++) out.push(r, g, b, 255);
  return Uint8ClampedArray.from(out);
}
const rgb = (s) => s.match(/\d+/g).slice(0, 3).map(Number);
const hueOf = (s) => palette.rgbToHsl(...rgb(s))[0];

test('una carátula gris o en blanco y negro deja el tema neutro', () => {
  assert.equal(palette.fromPixels(img([30, 30, 30, 500], [220, 220, 220, 500])), null);
  assert.equal(palette.fromPixels(img([128, 128, 128, 1024])), null);
});

test('una carátula roja da un acento rojo', () => {
  const p = palette.fromPixels(img([200, 30, 40, 1024]));
  const h = hueOf(p['--m3-primary']);
  assert.ok(h < 15 || h > 345, `tono ${h}`);
});

test('gana el color vivo aunque ocupe poco (portada oscura con detalle azul)', () => {
  const p = palette.fromPixels(img([12, 12, 14, 900], [30, 90, 230, 124]));
  const h = hueOf(p['--m3-primary']);
  assert.ok(h > 200 && h < 240, `tono ${h}`);
});

test('el acento contrasta al menos 3:1 con la app y con el fondo de Now Playing', () => {
  for (const c of [[200, 30, 40], [250, 240, 200], [20, 60, 30], [240, 200, 20], [90, 40, 160]]) {
    const p = palette.fromPixels(img([...c, 1024]));
    if (!p) continue;
    const a = rgb(p['--m3-primary']);
    assert.ok(palette.contrast(a, [24, 24, 24]) >= 3, `app ${c} → ${a}`);
    const np = c.map((v) => Math.round(v * 0.55 * 0.65));
    assert.ok(palette.contrast(a, np) >= 3, `Now Playing ${c} → ${a}`);
  }
});

test('el icono sobre el acento es el de más contraste (negro o blanco)', () => {
  const p = palette.fromPixels(img([240, 200, 20, 1024]));
  const a = rgb(p['--m3-primary']);
  const on = rgb(p['--m3-on-primary']);
  const other = on[0] === 0 ? [255, 255, 255] : [0, 0, 0];
  assert.ok(palette.contrast(a, on) >= palette.contrast(a, other));
});

test('los píxeles transparentes no cuentan', () => {
  const px = Uint8ClampedArray.from([200, 30, 40, 0, 200, 30, 40, 0]);
  assert.equal(palette.fromPixels(px), null);
});

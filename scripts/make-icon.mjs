// Genera los iconos de la app, sin dependencias (PNG e ICO escritos a mano con zlib):
// - build/icon.png (256) y build/icon.ico (16–256): círculo rojo con tres barras blancas en forma de
//   play (diseño de Figma); build/icon-simple.* es la versión negra con barras rojas que se elige
//   en los ajustes. Cada tamaño del .ico se dibuja aparte para que se vea nítido.
// - build/thumb-*.png (16 px y @2x 32 px): botones blancos de la vista previa de la barra de
//   tareas (anterior, reproducir, pausa, siguiente).
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const DARK = [28, 28, 34];
const WHITE = [255, 255, 255];

// Triángulo que apunta a la derecha: punta en (x1, cy), base vertical en x0 de alto 2·h.
const inTriangle = (u, v, x0, x1, cy, h) => u >= x0 && u <= x1 && Math.abs(v - cy) <= (h * (x1 - u)) / (x1 - x0);
const inRect = (u, v, x0, x1, y0, y1) => u >= x0 && u <= x1 && v >= y0 && v <= y1;

// Iconos de la app en coordenadas unitarias (0..1): círculo con tres barras blancas que bajan de
// alto y forman un "play", con puntas redondas. Medidas del diseño de Figma (lienzo de 536 px).
// Color del punto o null (transparente).
const FIGMA = 536;
const BARS = [[182, 143, 250], [262, 183, 170], [342, 223, 90]]; // [x, y, alto]
const BAR_W = 56;
// Punto dentro de un rectángulo con un radio distinto en cada esquina.
function inRoundRect(x, y, x0, y0, w, h, r) {
  if (x < x0 || x > x0 + w || y < y0 || y > y0 + h) return false;
  const corner = (cx, cy, rad) => rad > 0 && Math.hypot(x - cx, y - cy) > rad;
  if (x < x0 + r.tl && y < y0 + r.tl) return !corner(x0 + r.tl, y0 + r.tl, r.tl);
  if (x > x0 + w - r.tr && y < y0 + r.tr) return !corner(x0 + w - r.tr, y0 + r.tr, r.tr);
  if (x > x0 + w - r.br && y > y0 + h - r.br) return !corner(x0 + w - r.br, y0 + h - r.br, r.br);
  if (x < x0 + r.bl && y > y0 + h - r.bl) return !corner(x0 + r.bl, y0 + h - r.bl, r.bl);
  return true;
}
// Barras con la esquina de abajo a la izquierda un poco menos redonda.
const CORNERS = { tl: 28, tr: 28, br: 28, bl: 20 };
const appIcon = (bg, bar) => (u, v) => {
  if (Math.hypot(u - 0.5, v - 0.5) > 0.5) return null;
  const x = u * FIGMA, y = v * FIGMA;
  return BARS.some(([x0, y0, h]) => inRoundRect(x, y, x0, y0, BAR_W, h, CORNERS)) ? bar : bg;
};
const RED = [223, 28, 67];
const CORAL = [255, 92, 92];
// icon: el de siempre (rojo con barras blancas). icon-simple: la versión simplificada de los
// ajustes (negro con barras rojas).
const ICONS = { icon: appIcon(RED, WHITE), 'icon-simple': appIcon(DARK, CORAL) };

// Glifos de la barra de tareas, blancos sobre transparente.
const GLYPHS = {
  play: (u, v) => (inTriangle(u, v, 0.28, 0.8, 0.5, 0.32) ? WHITE : null),
  pause: (u, v) => (inRect(u, v, 0.24, 0.42, 0.18, 0.82) || inRect(u, v, 0.58, 0.76, 0.18, 0.82) ? WHITE : null),
  next: (u, v) => (inTriangle(u, v, 0.18, 0.66, 0.5, 0.3) || inRect(u, v, 0.68, 0.8, 0.2, 0.8) ? WHITE : null),
  prev: (u, v) => GLYPHS.next(1 - u, v),
};

// Rasteriza a `size` px con 4×4 muestras por píxel (antialias). Devuelve RGBA fila a fila.
function render(size, shape) {
  const S = 4;
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const c = shape((x + (sx + 0.5) / S) / size, (y + (sy + 0.5) / S) / size);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a++;
        }
      }
      const o = (y * size + x) * 4;
      if (a) { rgba[o] = r / a; rgba[o + 1] = g / a; rgba[o + 2] = b / a; }
      rgba[o + 3] = Math.round((255 * a) / (S * S));
    }
  }
  return rgba;
}

// Entrada BMP de un .ico: cabecera BITMAPINFOHEADER, píxeles BGRA de abajo arriba y máscara
// AND de 1 bit (vacía: la transparencia la da el canal alfa).
function bmpEntry(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // alto doble: imagen + máscara
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = ((size - 1 - y) * size + x) * 4;
      pixels[dst] = rgba[src + 2]; pixels[dst + 1] = rgba[src + 1];
      pixels[dst + 2] = rgba[src]; pixels[dst + 3] = rgba[src + 3];
    }
  }
  const maskRow = Math.ceil(size / 32) * 4;
  return Buffer.concat([header, pixels, Buffer.alloc(maskRow * size)]);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ICO como los de Windows: BMP en los tamaños pequeños (los entiende cualquier API) y PNG en 256.
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const outDir = join(root, 'build');
mkdirSync(outDir, { recursive: true });
for (const [name, shape] of Object.entries(ICONS)) {
  const images = ICO_SIZES.map((size) => {
    const rgba = render(size, shape);
    return { size, data: size >= 256 ? png(size, rgba) : bmpEntry(size, rgba) };
  });
  writeFileSync(join(outDir, `${name}.png`), images.find((i) => i.size === 256).data);
  writeFileSync(join(outDir, `${name}.ico`), ico(images));
}
for (const [name, shape] of Object.entries(GLYPHS)) {
  writeFileSync(join(outDir, `thumb-${name}.png`), png(16, render(16, shape)));
  writeFileSync(join(outDir, `thumb-${name}@2x.png`), png(32, render(32, shape)));
}
console.log('Iconos generados en', outDir, '(ico', ICO_SIZES.join('/'), 'px + botones de la barra de tareas)');

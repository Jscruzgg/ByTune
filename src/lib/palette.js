// Acento adaptativo desde la carátula (Apple Music): solo para lo resaltado (reproducir, progreso,
// botones activos, la canción actual). Las superficies siguen neutras y translúcidas: dejan pasar
// el fondo de la carátula en vez de teñirse. Sin require ni APIs de Node: main.js inyecta este
// texto en el mundo aislado del preload, que le pasa los píxeles de una miniatura de la carátula.
const mdPalette = (() => {
  // Superficie de la app (barra del reproductor, tarjetas): el acento debe leerse sobre ella.
  const APP_BG = [24, 24, 24];
  // Croma medio por debajo del cual la carátula es casi gris y se queda el tema neutro (medido con
  // portadas reales: blanco y negro 0,003–0,02; pastel 0,09–0,12; vivas 0,24–0,68).
  const MIN_CHROMA = 0.05;

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [(h * 60 + 360) % 360, s, l];
  }
  function hslToRgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [r, g, b].map((v) => Math.round((v + m) * 255));
  }
  // Luminancia relativa y contraste de WCAG.
  function luminance([r, g, b]) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  function contrast(a, b) {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  }

  // Tono dominante entre los píxeles con color: 24 cubos de tono, cada píxel pesa su croma
  // (saturado y ni muy claro ni muy oscuro). Gana el cubo con más peso, no el más abundante:
  // una portada casi negra con un detalle rojo da rojo.
  function dominant(pixels) {
    const BUCKETS = 24;
    const w = new Array(BUCKETS).fill(0);
    const sx = new Array(BUCKETS).fill(0);
    const sy = new Array(BUCKETS).fill(0);
    const ss = new Array(BUCKETS).fill(0);
    let total = 0;
    let n = 0;
    const avg = [0, 0, 0];
    for (let i = 0; i + 3 < pixels.length; i += 4) {
      if (pixels[i + 3] < 128) continue;
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      avg[0] += r; avg[1] += g; avg[2] += b; n++;
      const [h, s, l] = rgbToHsl(r, g, b);
      const chroma = s * (1 - Math.abs(2 * l - 1));
      total += chroma;
      if (chroma < 0.05) continue;
      const k = Math.floor(h / (360 / BUCKETS)) % BUCKETS;
      w[k] += chroma;
      sx[k] += Math.cos((h * Math.PI) / 180) * chroma;
      sy[k] += Math.sin((h * Math.PI) / 180) * chroma;
      ss[k] += s * chroma;
    }
    if (!n) return null;
    const mean = avg.map((v) => Math.round(v / n));
    // Cubos vecinos suman (un tono partido en dos cubos no pierde).
    let best = -1;
    let bestW = 0;
    for (let k = 0; k < BUCKETS; k++) {
      const v = w[k] + 0.5 * (w[(k + 1) % BUCKETS] + w[(k + BUCKETS - 1) % BUCKETS]);
      if (v > bestW) { bestW = v; best = k; }
    }
    // El cubo ganador cuenta con sus vecinos (bestW): en portadas de varios colores (rosa y azul)
    // ninguno solo llegaba y salía gris.
    if (best < 0 || total / n < MIN_CHROMA || bestW / n < MIN_CHROMA * 0.4) return { mean, hue: null };
    const hue = ((Math.atan2(sy[best], sx[best]) * 180) / Math.PI + 360) % 360;
    return { mean, hue, sat: ss[best] / w[best] };
  }

  // Fondo de Now Playing estimado desde el color medio: la carátula con brightness(.55) y el
  // degradado oscuro de encima (theme.css), ~0,35 de media.
  const npBackground = (mean) => mean.map((v) => Math.round(v * 0.55 * 0.65));

  // Acento: el tono dominante, saturado, con la luminosidad que más contraste da a la vez con la
  // superficie de la app y con el fondo de Now Playing (mínimo 3:1, el de los controles en WCAG).
  function accentFor(hue, sat, npBg) {
    // Tan vivo como la portada: una pastel da un acento suave, una saturada uno intenso.
    const s = Math.min(0.9, Math.max(0.35, sat * 1.3));
    let best = null;
    for (let l = 0.5; l <= 0.86; l += 0.02) {
      const rgb = hslToRgb(hue, s, l);
      const score = Math.min(contrast(rgb, APP_BG), contrast(rgb, npBg));
      // Entre los que pasan 3:1, el más oscuro conserva más color; si ninguno pasa, el de más contraste.
      if (score >= 3) return rgb;
      if (!best || score > best.score) best = { rgb, score };
    }
    return best.rgb;
  }

  const css = ([r, g, b], a) => (a === undefined ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`);

  // Píxeles RGBA (de un canvas) → variables CSS del acento, o null si la carátula es casi gris (se
  // quitan y vuelve el acento neutro del tema).
  function fromPixels(pixels) {
    const d = dominant(pixels);
    if (!d || d.hue === null) return null;
    const accent = accentFor(d.hue, d.sat, npBackground(d.mean));
    // Texto e iconos sobre el acento: el que más contraste.
    const onAccent = contrast(accent, [0, 0, 0]) >= contrast(accent, [255, 255, 255]) ? [0, 0, 0] : [255, 255, 255];
    return {
      '--md-accent-rgb': accent.join(', '),
      '--m3-primary': css(accent),
      '--m3-on-primary': css(onAccent),
      '--md-selected': css(accent, 0.16), // la canción actual de la cola: un velo del acento
    };
  }

  return { fromPixels, contrast, rgbToHsl, hslToRgb, dominant };
})();
if (typeof module !== 'undefined') module.exports = mdPalette;

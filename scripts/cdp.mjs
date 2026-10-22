// Herramienta de desarrollo: habla con la app por Chrome DevTools Protocol.
// Arranca la app con YTM_DEBUG_PORT=9222 y luego:
//   node scripts/cdp.mjs eval "<js>"         evalúa JS en la página
//   node scripts/cdp.mjs shot out.png [w h]  captura la página
//   node scripts/cdp.mjs css src/theme.css   reinyecta el tema sin reiniciar
//   node scripts/cdp.mjs metrics             métricas de rendimiento + FPS de scroll
//   node scripts/cdp.mjs go <url>            navega
import { readFileSync, writeFileSync } from 'node:fs';

const PORT = process.env.YTM_DEBUG_PORT || 9222;
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = targets.find((t) => t.type === 'page' && t.url.includes('music.youtube.com')) || targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  pending.set(n, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

// YTM_SIZE=900x640 emula ese tamaño de ventana durante el comando.
if (process.env.YTM_SIZE) {
  const [width, height] = process.env.YTM_SIZE.split('x').map(Number);
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await new Promise((r) => setTimeout(r, 800));
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'eval') {
  console.log(JSON.stringify(await evaluate(args.join(' ')), null, 2));
} else if (cmd === 'shot') {
  // Con ancho y alto, emula ese tamaño de ventana solo para la captura.
  if (args[1]) {
    await send('Emulation.setDeviceMetricsOverride', { width: +args[1], height: +args[2], deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 800));
  }
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  if (args[1]) await send('Emulation.clearDeviceMetricsOverride');
  writeFileSync(args[0], Buffer.from(data, 'base64'));
  console.log('Captura:', args[0]);
} else if (cmd === 'css') {
  const css = readFileSync(args[0], 'utf8');
  await evaluate(`(() => { let s = document.getElementById('md-theme-dev'); if (!s) { s = document.createElement('style'); s.id = 'md-theme-dev'; document.documentElement.appendChild(s); } s.textContent = ${JSON.stringify(css)}; return 'ok'; })()`);
  console.log('Tema reinyectado');
} else if (cmd === 'matched') {
  // Qué reglas declaran una propiedad en un elemento, en orden de cascada (la última gana).
  await send('DOM.enable');
  await send('CSS.enable');
  const { root } = await send('DOM.getDocument', { depth: 0 });
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: args[0] });
  const m = await send('CSS.getMatchedStylesForNode', { nodeId });
  const prop = args[1];
  for (const { rule } of m.matchedCSSRules || []) {
    const decl = rule.style.cssProperties.find((p) => p.name === prop && !p.disabled && p.value);
    if (decl) console.log(`[${rule.origin}] ${rule.selectorList.text.slice(0, 110)} → ${decl.value}${decl.important ? ' !important' : ''}`);
  }
  if (m.inlineStyle) {
    const decl = m.inlineStyle.cssProperties.find((p) => p.name === prop && p.value);
    if (decl) console.log(`[inline] → ${decl.value}`);
  }
} else if (cmd === 'overlaps') {
  // Emula varios anchos de ventana y comprueba que ningún control de la barra se pise con otro
  // ni se salga de ella. Uso: node scripts/cdp.mjs overlaps [ancho1,ancho2,...]
  const widths = (args[0] || '1920,1600,1440,1280,1100,1000,900,800,700,600').split(',').map(Number);
  let failures = 0;
  for (const width of widths) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 820, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 900));
    const res = await evaluate(`(() => {
      const bar = document.querySelector('ytmusic-player-bar[slot="player-bar"]');
      // En ventanas muy estrechas YT oculta la barra y usa su minirreproductor móvil.
      if (document.querySelector('ytmusic-app-layout[is-mweb-player-bar-modernization-enabled]')) return { problems: [], titleWidth: 0, n: 0, mobile: true };
      const vis = (e) => { if (!e) return false; const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && +s.opacity > 0.1; };
      const box = (name, e) => { const r = e.getBoundingClientRect(); return { name, l: r.left, r: r.right, t: r.top, b: r.bottom }; };
      const items = [];
      const add = (name, sel) => document.querySelectorAll(sel).forEach((e, i) => { if (vis(e)) items.push(box(name + (i ? i : ''), e)); });
      add('carátula', 'ytmusic-player-bar[slot="player-bar"] .thumbnail-image-wrapper');
      add('título', 'ytmusic-player-bar[slot="player-bar"] .content-info-wrapper');
      add('botón-centro', 'ytmusic-player-bar[slot="player-bar"] .left-controls-buttons > yt-icon-button');
      add('menú', 'ytmusic-player-bar[slot="player-bar"] ytmusic-menu-renderer');
      add('píldora', 'ytmusic-player-bar[slot="player-bar"] ytmusic-like-button-renderer');
      add('botón-derecha', 'ytmusic-player-bar[slot="player-bar"] .right-controls-buttons yt-icon-button, ytmusic-player-bar[slot="player-bar"] #right-controls > yt-icon-button');
      const pb = document.querySelector('ytmusic-player-bar[slot="player-bar"] #progress-bar');
      if (vis(pb)) { const r = pb.getBoundingClientRect(); items.push({ name: 'progreso', l: r.left, r: r.right, t: r.top, b: r.bottom }, { name: 'tiempo-inicio', l: r.left - 50, r: r.left - 6, t: r.top, b: r.bottom }, { name: 'tiempo-total', l: r.right + 6, r: r.right + 50, t: r.top, b: r.bottom }); }
      const b = bar.getBoundingClientRect();
      const problems = [];
      for (const it of items) if (it.l < b.left - 1 || it.r > b.right + 1 || it.t < b.top - 1 || it.b > b.bottom + 1) problems.push(it.name + ' se sale de la barra');
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const a = items[i], c = items[j];
        const ox = Math.min(a.r, c.r) - Math.max(a.l, c.l), oy = Math.min(a.b, c.b) - Math.max(a.t, c.t);
        if (ox > 1 && oy > 1) problems.push(a.name + ' ↔ ' + c.name + ' (' + Math.round(ox) + 'px)');
      }
      const title = items.find((x) => x.name === 'título');
      return { problems, titleWidth: title ? Math.round(title.r - title.l) : 0, n: items.length };
    })()`);
    failures += res.problems.length;
    if (res.mobile) { console.log(`${String(width).padStart(4)} px · minirreproductor móvil de YT (sin barra)`); continue; }
    console.log(`${String(width).padStart(4)} px · ${res.n} elementos · título ${res.titleWidth}px · ${res.problems.length ? 'PISADOS: ' + res.problems.join('; ') : 'ok'}`);
  }
  await send('Emulation.clearDeviceMetricsOverride');
  console.log(failures ? `${failures} problemas` : 'Sin solapes en ningún ancho');
} else if (cmd === 'navcheck') {
  // Barra superior en varios anchos: buscador centrado y sin pisar logo ni avatar.
  const widths = (args[0] || '1920,1600,1440,1280,1100,1000,940,900,860,800,760,700,640').split(',').map(Number);
  let failures = 0;
  for (const width of widths) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 820, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 900));
    const r = await evaluate(`(() => {
      const vis = (e) => e && e.getBoundingClientRect().width > 1 && getComputedStyle(e).visibility !== 'hidden';
      const box = (e) => e.getBoundingClientRect();
      const sb = document.querySelector('ytmusic-nav-bar ytmusic-search-box');
      const logo = document.querySelector('ytmusic-nav-bar ytmusic-logo');
      const right = [...document.querySelectorAll('ytmusic-nav-bar #right-content > *')].filter(vis);
      // En ventanas estrechas YT deja solo el icono de búsqueda (≈ 54 px) en su sitio.
      if (!vis(sb) || box(sb).width < 100) return { collapsed: true };
      const s = box(sb);
      const rightLeft = Math.min(...right.map((e) => box(e).left));
      const logoRight = vis(logo) ? box(logo).right : 0;
      return { w: Math.round(s.width), offCenter: Math.round((s.left + s.right) / 2 - innerWidth / 2), gapLeft: Math.round(s.left - logoRight), gapRight: Math.round(rightLeft - s.right) };
    })()`);
    if (r.collapsed) { console.log(`${String(width).padStart(4)} px · YT muestra solo el icono de búsqueda`); continue; }
    const ok = Math.abs(r.offCenter) <= 6 && r.gapLeft >= 16 && r.gapRight >= 16;
    if (!ok) failures++;
    console.log(`${String(width).padStart(4)} px · ancho ${r.w} · desvío del centro ${r.offCenter}px · libre izq ${r.gapLeft} / der ${r.gapRight} · ${ok ? 'ok' : 'PROBLEMA'}`);
  }
  await send('Emulation.clearDeviceMetricsOverride');
  console.log(failures ? `${failures} problemas` : 'Buscador centrado y sin solapes en todos los anchos');
} else if (cmd === 'click') {
  // Clic real de ratón (Input de CDP) en el centro del elemento: node scripts/cdp.mjs click "<selector>"
  const p = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(args[0])}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!p) { console.log('No existe:', args[0]); } else {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
    }
    console.log('Clic en', Math.round(p.x), Math.round(p.y));
  }
} else if (cmd === 'key') {
  // Pulsación real de tecla: node scripts/cdp.mjs key Escape
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: args[0], code: args[0], windowsVirtualKeyCode: args[0] === 'Escape' ? 27 : 0 });
  console.log('Tecla', args[0]);
} else if (cmd === 'go') {
  await send('Page.navigate', { url: args[0] });
  await new Promise((r) => setTimeout(r, 4000));
  console.log('Navegado');
} else if (cmd === 'metrics') {
  await send('Performance.enable');
  const snap = async () => Object.fromEntries((await send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  const before = await snap();
  // FPS y frames largos durante un scroll programado de ~3 s por el contenido principal.
  const scroll = await evaluate(`new Promise((resolve) => {
    const el = document.scrollingElement;
    const start = performance.now(); let frames = 0, slow = 0, last = start, worst = 0;
    el.scrollTop = 0;
    function step(t) {
      const dt = t - last; last = t; frames++;
      if (dt > 20) slow++; if (dt > worst) worst = dt;
      el.scrollTop += 12;
      if (t - start < 3000) requestAnimationFrame(step);
      else { el.scrollTop = 0; resolve({ fps: +(frames / ((t - start) / 1000)).toFixed(1), slowFrames: slow, worstFrameMs: +worst.toFixed(1) }); }
    }
    requestAnimationFrame(step);
  })`);
  const m = await snap();
  const d = (k) => m[k] - before[k];
  const dom = await evaluate(`({ nodes: document.getElementsByTagName('*').length })`);
  // Todo lo de abajo (salvo heap y nodos) es lo ocurrido durante el scroll.
  console.log(JSON.stringify({
    ...scroll,
    jsHeapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1),
    domNodes: dom.nodes,
    layouts: d('LayoutCount'),
    styleRecalcs: d('RecalcStyleCount'),
    layoutMs: +(d('LayoutDuration') * 1000).toFixed(0),
    styleMs: +(d('RecalcStyleDuration') * 1000).toFixed(0),
    scriptMs: +(d('ScriptDuration') * 1000).toFixed(0),
    taskMs: +(d('TaskDuration') * 1000).toFixed(0),
  }, null, 2));
}
if (process.env.YTM_SIZE) await send('Emulation.clearDeviceMetricsOverride');
ws.close();

// Prueba de interacción del "me gusta" / "no me gusta" con clics reales de ratón (Input de CDP,
// igual que un clic físico). Pulsa cada botón dos veces (marcar y desmarcar) varias rondas y
// comprueba en cada clic: que el estado cambia, que el icono cambia y que Now Playing no se abre.
// Termina siempre con el mismo estado con el que empezó. Arranca la app con YTM_DEBUG_PORT=9222.
const PORT = process.env.YTM_DEBUG_PORT || 9222;
const ROUNDS = Number(process.argv[2] || 3);
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = targets.find((t) => t.type === 'page' && t.url.includes('music.youtube.com'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const state = (kind) => evaluate(`(() => {
  const b = document.querySelector('ytmusic-player-bar[slot="player-bar"] yt-button-shape.${kind} button');
  const r = b.getBoundingClientRect();
  return { pressed: b.getAttribute('aria-pressed'), icon: (b.querySelector('path') || {}).getAttribute ? b.querySelector('path').getAttribute('d').slice(0, 24) : '',
    x: r.left + r.width / 2, y: r.top + r.height / 2,
    nowPlaying: document.querySelector('ytmusic-app-layout').hasAttribute('player-page-open') };
})()`);

async function realClick(x, y) {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
  }
}

// Now Playing cerrado para empezar
if ((await state('like')).nowPlaying) {
  await evaluate(`document.querySelector('ytmusic-player-bar[slot="player-bar"] .toggle-player-page-button').click()`);
  await wait(1200);
}

let failures = 0;

// "Me gusta": marcar y desmarcar sobre la misma canción.
{
  const kind = 'like';
  const initial = await state(kind);
  for (let round = 1; round <= ROUNDS * 2; round++) {
    const before = await state(kind);
    await realClick(before.x, before.y);
    await wait(1500);
    const after = await state(kind);
    const toggled = after.pressed !== before.pressed;
    const iconChanged = after.icon !== before.icon;
    const ok = toggled && iconChanged && !after.nowPlaying;
    if (!ok) failures++;
    console.log(`${kind} clic ${round}: ${before.pressed} → ${after.pressed} · icono ${iconChanged ? 'cambia' : 'IGUAL'} · Now Playing ${after.nowPlaying ? 'ABIERTO' : 'cerrado'} · ${ok ? 'ok' : 'FALLO'}`);
    if (after.nowPlaying) {
      await evaluate(`document.querySelector('ytmusic-player-bar[slot="player-bar"] .toggle-player-page-button').click()`);
      await wait(1200);
    }
  }
  const end = await state(kind);
  if (end.pressed !== initial.pressed) console.log(`AVISO: ${kind} no volvió a su estado inicial (${initial.pressed})`);
}

// "No me gusta": en YT Music marca la canción y SALTA a la siguiente. Cada ronda: marcar (debe
// saltar sin abrir Now Playing), volver a esa canción (debe seguir marcada) y desmarcar (debe
// quedar sin marca). Así la prueba no deja nada marcado en la cuenta.
const title = () => evaluate(`document.querySelector('ytmusic-player-bar[slot="player-bar"] .title').textContent.trim()`);
const playFromQueue = (t) => evaluate(`(() => { const items = [...document.querySelectorAll('ytmusic-player-page ytmusic-player-queue#queue ytmusic-player-queue-item')]; const it = items.reverse().find(i => (i.querySelector('.song-title') || {}).textContent === ${JSON.stringify(t)}); if (!it) return false; (it.querySelector('ytmusic-play-button-renderer') || it).click(); return true; })()`);
for (let round = 1; round <= ROUNDS; round++) {
  const song = await title();
  const before = await state('dislike');
  if (before.pressed === 'true') { console.log(`dislike ronda ${round}: "${song}" ya tenía "no me gusta", se omite`); continue; }
  await realClick(before.x, before.y);
  await wait(2500);
  const skipped = (await title()) !== song;
  const np1 = (await state('dislike')).nowPlaying;
  const found = await playFromQueue(song);
  await wait(3000);
  const back = await state('dislike');
  const marked = back.pressed === 'true' && (await title()) === song;
  await realClick(back.x, back.y);
  await wait(2000);
  const after = await state('dislike');
  const cleared = after.pressed === 'false';
  const ok = skipped && !np1 && found && marked && cleared && !after.nowPlaying;
  if (!ok) failures++;
  console.log(`dislike ronda ${round} "${song}": salta ${skipped ? 'sí' : 'NO'} · Now Playing ${np1 || after.nowPlaying ? 'ABIERTO' : 'cerrado'} · queda marcada ${marked ? 'sí' : 'NO'} · se desmarca ${cleared ? 'sí' : 'NO'} · ${ok ? 'ok' : 'FALLO'}`);
  if (!cleared) console.log(`  ATENCIÓN: "${song}" puede haber quedado con "no me gusta"`);
}
console.log(failures ? `${failures} fallos` : 'Todo bien: me gusta y no me gusta responden en cada clic y Now Playing no se abre');
ws.close();

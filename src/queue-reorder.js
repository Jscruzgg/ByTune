// Reordenar la cola arrastrando las canciones (mundo principal de la página; main.js lo inyecta
// junto a lyrics-view.js). La cola de YT vive en su store (el de document.querySelector('ytmusic-app')
// .queue): sus canciones ("A continuación") se mueven con la acción MOVE_ITEM, como hace el propio
// YT, y las de reproducción automática se reordenan con REPLACE_AUTOMIX_ITEMS. Cada canción se
// mueve dentro de su lista. Se pulsa una canción por su texto, se arrastra y, al soltarla, se le
// pide a YT el cambio; la siguiente canción sale ya en el nuevo orden. La miniatura sigue
// reproduciendo con un clic. Durante el arrastre solo se mueven transformaciones.
// Límite: YT además avisa a sus servidores de la cola (no hay forma de pedirlo desde aquí), así que
// si YT vuelve a cargar la cola de sus servidores, puede recuperar el orden anterior.
if (window.__mdQueueReorder && window.__mdQueueReorder.destroy) window.__mdQueueReorder.destroy();
window.__mdQueueReorder = (() => {
  const ITEM = 'ytmusic-player-queue-item';
  const THRESHOLD = 6; // px de movimiento para que un clic pase a ser arrastre
  const html = document.documentElement;
  let drag = null; // { store, automix, items, from, to, startY, el, started, rects, h }
  let swallowClick = false; // el clic que llega al soltar tras arrastrar no debe reproducir

  function onPointerDown(e) {
    if (e.button !== 0 || !(e.target instanceof Element)) return;
    const el = e.target.closest(ITEM);
    if (!el) return;
    // Menú "⋮", botones y la miniatura (su clic reproduce la canción) quedan como en YT.
    if (e.target.closest('ytmusic-menu-renderer, yt-icon-button, button, a, .left-items')) return;
    const q = el.closest('ytmusic-player-queue');
    const store = q && q.queue && q.queue.store;
    const state = store && store.getState && store.getState().queue;
    if (!state) return;
    const automix = el.hasAttribute('is-automix');
    const items = [...q.querySelectorAll(automix ? `${ITEM}[is-automix]` : `${ITEM}:not([is-automix])`)];
    const from = items.indexOf(el);
    // Solo si lo que se ve es toda la lista de YT, en su orden: si no, el índice sería otro.
    const list = automix ? state.automixItems : state.items;
    if (from < 0 || !Array.isArray(list) || list.length !== items.length) return;
    if (!automix && el.data && el.data.canReorder === false) return;
    drag = { store, automix, items, from, to: from, startY: e.clientY, el, started: false };
  }
  // Pide a YT el nuevo orden.
  function move(d) {
    if (!d.automix) {
      d.store.dispatch({ type: 'MOVE_ITEM', payload: { fromIndex: d.from, toIndex: d.to } });
      return;
    }
    const list = d.store.getState().queue.automixItems.slice();
    list.splice(d.to, 0, list.splice(d.from, 1)[0]);
    d.store.dispatch({ type: 'REPLACE_AUTOMIX_ITEMS', payload: { automixItems: list, shouldAssignIds: false } });
  }
  // Mientras hay una canción de la cola pulsada, YT no recibe sus eventos de ratón: ni su propio
  // arrastre de la cola (que con el tema de la app no funciona y, sin él, movía las canciones a la
  // vez que este) ni su gesto de minimizar Now Playing arrastrando hacia abajo. La miniatura no
  // entra aquí (onPointerDown la deja fuera), así que su clic sigue reproduciendo la canción.
  function own(e) {
    if (!drag) return;
    e.stopPropagation();
    if (drag.started) e.preventDefault();
  }

  function start() {
    drag.started = true;
    drag.rects = drag.items.map((i) => i.getBoundingClientRect());
    drag.h = drag.rects[drag.from].height;
    html.setAttribute('data-md-q-dragging', '');
    drag.el.classList.add('md-q-drag');
  }

  function onPointerMove(e) {
    if (!drag) return;
    e.stopPropagation();
    const dy = e.clientY - drag.startY;
    if (!drag.started) {
      if (Math.abs(dy) < THRESHOLD) return;
      start();
    }
    const { rects: r, from } = drag;
    // La canción arrastrada no sale de la lista.
    const y = Math.max(r[0].top - r[from].top, Math.min(r[r.length - 1].top - r[from].top, dy));
    drag.el.style.transform = `translateY(${y}px)`;
    // Destino: la posición cuyo hueco contiene el centro de la canción arrastrada.
    const center = r[from].top + r[from].height / 2 + y;
    let to = drag.to;
    for (let i = 0; i < r.length; i++) if (center >= r[i].top && center < r[i].bottom) { to = i; break; }
    if (to === drag.to) return;
    drag.to = to;
    // Las de en medio se apartan un hueco para dejar sitio.
    drag.items.forEach((it, i) => {
      if (i === from) return;
      const shift = from < to && i > from && i <= to ? -drag.h : from > to && i >= to && i < from ? drag.h : 0;
      it.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  }

  function end(apply) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.started) return;
    // El clic que genera el navegador al soltar llega justo después, en esta misma tarea; si no
    // llega (se soltó sobre otra canción), el siguiente clic del usuario no debe perderse.
    swallowClick = apply;
    setTimeout(() => { swallowClick = false; }, 0);
    for (const it of d.items) it.style.transform = '';
    d.el.classList.remove('md-q-drag');
    html.removeAttribute('data-md-q-dragging');
    if (apply && d.to !== d.from) {
      try { move(d); } catch {}
    }
  }
  const onPointerUp = () => end(true);
  const onPointerCancel = () => end(false);
  function onClick(e) {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopPropagation();
    e.preventDefault();
  }
  function onKeyDown(e) { if (e.key === 'Escape' && drag && drag.started) end(false); }

  // En window y en captura: llegan antes que cualquier listener de YT (también los que YT pone en
  // document), así se le pueden ocultar eventos y tragar el clic de después de arrastrar.
  const LISTENERS = [
    ['pointerdown', onPointerDown], ['pointermove', onPointerMove], ['pointerup', onPointerUp],
    ['pointercancel', onPointerCancel], ['click', onClick], ['keydown', onKeyDown],
    ['mousedown', own], ['mousemove', own], ['mouseup', own], ['touchstart', own], ['touchmove', own],
  ];
  for (const [t, fn] of LISTENERS) window.addEventListener(t, fn, { capture: true, passive: false });

  return {
    destroy() {
      end(false);
      for (const [t, fn] of LISTENERS) window.removeEventListener(t, fn, true);
    },
  };
})();

// Se ejecuta en el contexto de la página (webContents.executeJavaScript desde main.js), donde
// están ytcfg y las cookies de la sesión. Pide a YT Music la lista de playlists de la biblioteca
// (la misma petición que hace su página "Biblioteca") y devuelve { browseId: urlPortada }.
// Usa window.__md.browse (src/page-api.js) para la autorización; sin él devuelve { error }.
(async () => {
  // Marca cada playlist de la barra lateral con su browseId (data-md-id). El id solo está en las
  // propiedades JS de YT, que preload.js (mundo aislado) no ve; los atributos sí. Se instala una
  // vez y sigue marcando cuando YT vuelve a pintar la lista.
  if (!window.__mdGuideTagger) {
    const tag = () => {
      for (const e of document.querySelectorAll('ytmusic-guide-entry-renderer')) {
        const ep = e.data && e.data.navigationEndpoint && e.data.navigationEndpoint.browseEndpoint;
        const id = ep && ep.browseId;
        if (id && id.startsWith('VL') && e.dataset.mdId !== id) e.dataset.mdId = id;
      }
    };
    let queued = false;
    window.__mdGuideTagger = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; tag(); });
    });
    window.__mdGuideTagger.observe(document.querySelector('ytmusic-app') || document.body, { childList: true, subtree: true });
    tag();
  }

  // La petición autenticada (SAPISIDHASH) es la de page-api.js, que main.js ejecuta antes.
  const browse = window.__md && window.__md.browse;
  if (!browse) return { error: 'sin __md' };
  // Recorre la respuesta buscando tarjetas de playlist (browseId + miniatura ≥ 60 px) y el token
  // de la página siguiente: YT devuelve la biblioteca por tramos.
  const covers = {};
  const scan = (json) => {
    let next = null;
    const walk = (o) => {
      if (!o || typeof o !== 'object') return;
      const item = o.musicTwoRowItemRenderer;
      if (item) {
        const id = item.navigationEndpoint && item.navigationEndpoint.browseEndpoint && item.navigationEndpoint.browseEndpoint.browseId;
        const thumbs = (((item.thumbnailRenderer || {}).musicThumbnailRenderer || {}).thumbnail || {}).thumbnails || [];
        const pick = thumbs.find((t) => t.width >= 60) || thumbs[thumbs.length - 1];
        if (id && pick) covers[id] = pick.url;
      }
      if (o.nextContinuationData && o.nextContinuationData.continuation) next = o.nextContinuationData.continuation;
      if (o.continuationCommand && o.continuationCommand.token) next = o.continuationCommand.token;
      for (const v of Object.values(o)) walk(v);
    };
    walk(json);
    return next;
  };
  try {
    let next = scan(await browse({ browseId: 'FEmusic_liked_playlists' }));
    for (let page = 0; next && page < 10; page++) next = scan(await browse({ continuation: next }));
  } catch (e) {
    if (!Object.keys(covers).length) return { error: e.message };
  }
  return { covers };
})()

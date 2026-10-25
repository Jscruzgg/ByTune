// Panel de letras dentro de la página (provisional: la vista completa llega después).
// main.js antepone lib/lyrics-timing.js y lo ejecuta en cada carga; luego llama a init.
// Habla con main.js por preload.js: deja el mensaje en <html data-md-lyrics-msg> y lanza 'md-lyrics'.
window.__mdLyrics = (() => {
  let opts = { open: false, strings: {} };

  function send(msg) {
    document.documentElement.dataset.mdLyricsMsg = JSON.stringify(msg);
    document.dispatchEvent(new Event('md-lyrics'));
  }

  // Canción actual: id del reproductor y título, artista y álbum de la barra visible.
  function currentTrack() {
    const player = document.querySelector('#movie_player');
    const data = player && player.getVideoData ? player.getVideoData() : null;
    const videoId = data && data.video_id;
    if (!videoId) return null;
    const bar = document.querySelector('ytmusic-player-bar[slot="player-bar"]');
    const title = ((bar && bar.querySelector('.title')) || {}).textContent || '';
    // La línea de artista es "Artista • Álbum • Año".
    const byline = (((bar && bar.querySelector('.byline')) || {}).textContent || '').split('•');
    const video = document.querySelector('video');
    const duration = video && Number.isFinite(video.duration) ? video.duration : null;
    return { videoId, title: title.trim(), artist: (byline[0] || '').trim(), album: (byline[1] || '').trim(), duration };
  }

  return {
    // Se puede llamar varias veces (al cargar y al cambiar de idioma): guarda y vuelve a pedir.
    init(next) {
      opts = { ...opts, ...next };
      const track = currentTrack();
      if (track) send({ type: 'request', track });
    },
    receive(videoId, result) {
      window.__mdLyricsLast = { videoId, kind: result.kind, n: (result.lines || []).length, source: result.source };
    },
  };
})();

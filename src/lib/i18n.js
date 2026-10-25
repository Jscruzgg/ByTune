// Textos de la app en español e inglés. Sin dependencias: lo usa main.js directamente y
// el preload (sandbox, no puede hacer require de esto) los recibe por IPC con el mensaje 'strings'.

const STRINGS = {
  es: {
    // Bandeja del sistema
    'tray.play': 'Reproducir',
    'tray.pause': 'Pausar',
    'tray.next': 'Siguiente',
    'tray.previous': 'Anterior',
    'tray.show': 'Mostrar ventana',
    'tray.quit': 'Salir',

    // Ajustes (también los usa la bandeja en sus casillas)
    'set.theme': 'Tema ByTune',
    'set.notify': 'Notificar cambio de canción',
    'set.closeToTray': 'Cerrar a la bandeja',
    'set.startWithWindows': 'Iniciar con Windows',
    'set.quickMenu': 'Menú rápido',
    'set.shortcut': 'Atajo',
    'set.shortcutHint': 'Pulsa la nueva combinación de teclas',
    'set.shortcutTaken': 'Otro programa ya usa ese atajo',
    'set.shortcutInvalid': 'Usa al menos Ctrl, Alt, Shift o Win más otra tecla',
    'set.shortcutReserved': 'ByTune ya usa ese atajo para otra cosa',
    'set.works': 'Funciona',
    'set.focused': 'Con la app enfocada',
    'set.anywhere': 'En cualquier lugar',
    'set.fromOtherApps': 'Desde otras apps',
    'set.float': 'Flotando sobre la app',
    'set.front': 'Trayendo la ventana al frente',
    'set.shiftEnter': 'Shift + Enter en una canción',
    'set.queue': 'Añadir al final de la cola',
    'set.next': 'Reproducir a continuación',
    'set.title': 'Ajustes',

    // Actualizaciones
    'upd.splash': 'Actualizando ByTune a la versión {version}…',
    'upd.check': 'Buscar actualizaciones',
    'upd.checking': 'Buscando…',
    'upd.latest': 'Ya tienes la última versión',
    'upd.unsupported': 'Solo en la versión instalada',
    'upd.error': 'No se pudo comprobar',

    // Botón atrás
    'nav.back': 'Atrás',

    // Letras
    'lyrics.show': 'Mostrar letra',
    'lyrics.hide': 'Ocultar letra',
    'lyrics.credit': 'Letra de LRCLIB',
    'lyrics.none': 'No hay letra para mostrar aquí :(',
    'np.fullscreen': 'Pantalla completa',
    'np.exitFullscreen': 'Salir de pantalla completa',
    'np.toVideo': 'Cambiar a vídeo',
    'np.toSong': 'Cambiar a canción',

    // Menú rápido
    'qm.placeholder': 'Buscar canciones o ir a una playlist…',
    'qm.recent': 'Recientes',
    'qm.suggested': 'Sugerencias',
    'qm.library': 'Tu biblioteca',
    'qm.songs': 'Canciones',
    'qm.playlist': 'Playlist',
    'qm.album': 'Álbum',
    'qm.added': 'Añadida a la cola',
    'qm.playingNext': 'Sonará a continuación',
    'qm.queueFailed': 'No se pudo añadir a la cola',
    'qm.move': 'mover',
    'qm.playOpen': 'reproducir / abrir',
    'qm.queueHint': 'a la cola',
    'qm.nextHint': 'a continuación',
    'qm.close': 'cerrar',
    'qm.playback': 'anterior / pausa / siguiente',
    'qm.allShortcuts': 'Todos los atajos (F1)',
  },
  en: {
    // System tray
    'tray.play': 'Play',
    'tray.pause': 'Pause',
    'tray.next': 'Next',
    'tray.previous': 'Previous',
    'tray.show': 'Show window',
    'tray.quit': 'Quit',

    // Settings (the tray checkboxes reuse these too)
    'set.theme': 'ByTune theme',
    'set.notify': 'Notify on song change',
    'set.closeToTray': 'Close to tray',
    'set.startWithWindows': 'Start with Windows',
    'set.quickMenu': 'Quick menu',
    'set.shortcut': 'Shortcut',
    'set.shortcutHint': 'Press the new key combination',
    'set.shortcutTaken': 'Another program already uses that shortcut',
    'set.shortcutInvalid': 'Use at least Ctrl, Alt, Shift or Win plus another key',
    'set.shortcutReserved': 'ByTune already uses that shortcut for something else',
    'set.works': 'Works',
    'set.focused': 'When the app is focused',
    'set.anywhere': 'Anywhere',
    'set.fromOtherApps': 'From other apps',
    'set.float': 'Floating over the app',
    'set.front': 'Bringing the window to the front',
    'set.shiftEnter': 'Shift + Enter on a song',
    'set.queue': 'Add to the end of the queue',
    'set.next': 'Play next',
    'set.title': 'Settings',

    // Updates
    'upd.splash': 'Updating ByTune to version {version}…',
    'upd.check': 'Check for updates',
    'upd.checking': 'Checking…',
    'upd.latest': "You're up to date",
    'upd.unsupported': 'Installed version only',
    'upd.error': "Couldn't check",

    // Back button
    'nav.back': 'Back',

    // Lyrics
    'lyrics.show': 'Show lyrics',
    'lyrics.hide': 'Hide lyrics',
    'lyrics.credit': 'Lyrics from LRCLIB',
    'lyrics.none': 'No lyrics to show here :(',
    'np.fullscreen': 'Full screen',
    'np.exitFullscreen': 'Exit full screen',
    'np.toVideo': 'Switch to video',
    'np.toSong': 'Switch to song',

    // Quick menu
    'qm.placeholder': 'Search songs or jump to a playlist…',
    'qm.recent': 'Recent',
    'qm.suggested': 'Suggested',
    'qm.library': 'Your library',
    'qm.songs': 'Songs',
    'qm.playlist': 'Playlist',
    'qm.album': 'Album',
    'qm.added': 'Added to the queue',
    'qm.playingNext': 'Plays next',
    'qm.queueFailed': "Couldn't add to the queue",
    'qm.move': 'move',
    'qm.playOpen': 'play / open',
    'qm.queueHint': 'add to queue',
    'qm.nextHint': 'play next',
    'qm.close': 'close',
    'qm.playback': 'previous / pause / next',
    'qm.allShortcuts': 'All shortcuts (F1)',
  },
};

// Cualquier código que empiece por "es" (es, es-419, ES-es…) es español; el resto, inglés.
function pickLang(code) {
  return typeof code === 'string' && /^es(?![a-z])/i.test(code.trim()) ? 'es' : 'en';
}

// Busca la clave en el idioma pedido, luego en inglés, y si no existe devuelve la propia clave.
// Reemplaza los marcadores {nombre} con los valores de vars.
function t(lang, key, vars) {
  const text = (STRINGS[lang] && STRINGS[lang][key]) ?? STRINGS.en[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? vars[name] : m)) : text;
}

module.exports = { pickLang, t, STRINGS };

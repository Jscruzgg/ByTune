// Preload del menú rápido (con sandbox: solo puede usar require('electron')).
// Expone window.qm; todo lo demás pasa por IPC con el proceso principal.
const { contextBridge, ipcRenderer } = require('electron');

// Cada suscripción sustituye a la anterior: así una recarga de la página no duplica los oyentes.
function suscribir(canal, cb) {
  ipcRenderer.removeAllListeners(canal);
  ipcRenderer.on(canal, (_e, datos) => cb(datos));
}

contextBridge.exposeInMainWorld('qm', {
  // Biblioteca al instante: { seq, library, songs: null }. Las canciones llegan después por onSongs.
  query: (seq, text) => ipcRenderer.invoke('qm:query', { seq, text }),
  onSongs: (cb) => suscribir('qm:songs', cb),
  // item: { kind: 'song'|'playlist'|'album', id }. Responde { keepOpen, note? }.
  activate: (item, shift) => ipcRenderer.invoke('qm:activate', { item, shift }),
  close: () => ipcRenderer.send('qm:close'),
  // { strings, recent, shiftEnter } cada vez que se abre el menú.
  onShow: (cb) => suscribir('qm:show', cb),
});

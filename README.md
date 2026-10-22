# Music Desktop

Cliente de escritorio (Electron) para YouTube Music: abre music.youtube.com en su propia ventana, con tu cuenta.

## Instalar (Windows)

1. Ve a **Releases** en GitHub y descarga la última versión:
   - `Music Desktop Setup x.y.z.exe`: instalador (crea accesos directos y desinstalador).
   - `Music Desktop x.y.z.exe`: versión portable, no hace falta instalar.
2. Ejecútalo. Como no está firmado, Windows SmartScreen puede avisar: *Más información → Ejecutar de todas formas*.
3. Inicia sesión con tu cuenta de Google dentro de la app (se recuerda entre reinicios).

## Compilar desde el código

Requisitos: Windows 10/11 y [Node.js](https://nodejs.org) 20 o superior.

```bash
git clone https://github.com/Jscruzgg/youtube-music-client.git
cd youtube-music-client
npm install
npx --no install-electron --no
npm run dist
```

- `npx --no install-electron --no` descarga el binario de Electron: las versiones recientes de npm bloquean los scripts de instalación y sin este paso Electron no arranca.
- `npm run dist` genera el icono y deja el instalador y la versión portable en `dist\`.
- Para probar sin instalar: `npm start`.

## Interfaz

- `src/theme.css`: tema propio (grises de Spotify en botones y chips, barra con la canción a la izquierda, controles al centro y tiempos a los lados del progreso, pantalla "Now Playing" con la carátula difuminada y título grande al estilo Apple Music). Los fondos de página (inicio, degradados según la carátula de álbumes y listas) se dejan como en YT Music. Se activa o desactiva desde la bandeja: *Tema Music Desktop*.
- `src/chrome.css`: quita la barra de título de Windows; la barra superior de la app sirve para arrastrar la ventana. Se aplica siempre.
- Solo CSS, sin JS extra en la página: sin `backdrop-filter`, transiciones solo de `transform`/`opacity`, `content-visibility` para lo que no está en pantalla, y el blur del fondo se hace sobre 64×64 px y se escala en la GPU.
- Álbumes y playlists al estilo Spotify (cabecera con carátula y título grande, play grande, lista a todo el ancho hasta 1400 px); cola de Now Playing pegada a la derecha; buscador centrado; botón "atrás" en la barra superior.
- Iterar en vivo: `YTM_DEBUG_PORT=9222 npm start` y `node scripts/cdp.mjs css src/theme.css` (también `shot`, `metrics`, `eval`, `click`); F5 recarga los CSS desde disco.
- Pruebas: `node scripts/cdp.mjs overlaps` (barra inferior sin solapes en varios anchos), `node scripts/cdp.mjs navcheck` (buscador centrado), `node scripts/test-like.mjs` (me gusta / no me gusta con clics reales; deshace lo que marca).

## Funciones

- La sesión de Google queda guardada entre reinicios.
- Icono en la bandeja: reproducir/pausar, siguiente, anterior, canción actual; clic para mostrar u ocultar.
- Al cerrar la ventana se queda en la bandeja (desactivable desde el menú de la bandeja).
- Notificación al cambiar de canción, opción "Iniciar con Windows".
- Teclas multimedia del teclado y panel multimedia de Windows (vía Chromium).
- Atajos globales: `Ctrl+Alt+Espacio` reproducir/pausar, `Ctrl+Alt+→/←` siguiente/anterior, `Ctrl+Alt+M` mostrar/ocultar.
- En la ventana: `F5` recargar, `Alt+←/→` atrás/adelante, `Ctrl +/-/0` zoom.
- Los enlaces externos se abren en tu navegador.
- Recuerda el tamaño y la posición de la ventana.

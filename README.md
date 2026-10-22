# Music Desktop

Cliente de escritorio (Electron) para YouTube Music: abre music.youtube.com en su propia ventana, con tu cuenta.

## Uso

- **Instalar:** `dist\Music Desktop Setup 1.0.0.exe` (o `dist\Music Desktop 1.0.0.exe`, portable, sin instalar).
- **Desarrollo:** `npm start`. Generar instaladores: `npm run dist`.
  - Si Electron no arranca tras `npm install` (npm bloquea scripts de instalación): `npx --no install-electron --no`.

## Interfaz

- `src/theme.css`: tema propio (grises de Spotify en botones y chips, barra con la canción a la izquierda, controles al centro y tiempos a los lados del progreso, pantalla "Now Playing" con la carátula difuminada y título grande al estilo Apple Music). Los fondos de página (inicio, degradados según la carátula de álbumes y listas) se dejan como en YT Music. Se activa o desactiva desde la bandeja: *Tema Music Desktop*.
- `src/chrome.css`: quita la barra de título de Windows; la barra superior de la app sirve para arrastrar la ventana. Se aplica siempre.
- Solo CSS, sin JS extra en la página: sin `backdrop-filter`, transiciones solo de `transform`/`opacity`, `content-visibility` para lo que no está en pantalla, y el blur del fondo se hace sobre 64×64 px y se escala en la GPU.
- Iterar en vivo: `YTM_DEBUG_PORT=9222 npm start` y `node scripts/cdp.mjs css src/theme.css` (también `shot`, `metrics`, `eval`); F5 recarga los CSS desde disco.

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

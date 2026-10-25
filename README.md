# ByTune

Desktop client (Electron) for YouTube Music: opens music.youtube.com in its own window, signed in with your account.

## Install (Windows)

1. Go to **Releases** on GitHub and download the latest version:
   - `ByTune-Setup-x.y.z.exe`: installer (shortcuts and uninstaller; updates itself).
   - `ByTune-x.y.z-portable.exe`: portable, no install needed (does not update itself).
2. Run it. The app is not code-signed, so Windows SmartScreen may warn: *More info → Run anyway*.
3. Sign in with your Google account inside the app (the session is remembered between restarts).

## Updates

The installed app checks GitHub Releases for a new version every time it opens. If there is one, it downloads it in the background and asks whether to restart to install it; if you choose "Later", it installs when you quit (you can also do it from the tray icon). The portable version does not update itself. The log is at `%APPDATA%\ByTune\updater.log` (`%APPDATA%\Music Desktop\updater.log` for copies installed before the app was renamed: they keep their data folder).

Every PR merged to `main` publishes a release automatically (`.github/workflows/release.yml`): if the PR didn't bump `version` in `package.json`, the workflow bumps the patch and commits it to `main`. To publish by hand instead: bump `version`, commit and push, then run `npm run release` (requires `gh` signed in). The script checks that tests pass, that there are no unpushed changes and that the version does not exist yet, then builds and publishes the installer, its `.blockmap` and `latest.yml`.

## Build from source

Requirements: Windows 10/11 and [Node.js](https://nodejs.org) 20 or later.

```bash
git clone https://github.com/Jscruzgg/ByTune.git
cd ByTune
npm install
npx --no install-electron --no
npm run dist
```

- `npx --no install-electron --no` downloads the Electron binary: recent npm versions block install scripts, and without this step Electron does not start.
- `npm run dist` generates the icons and puts the installer and the portable version in `dist\`.
- To try it without installing: `npm start`.

## Interface

- `src/theme.css`: custom theme (Spotify-style grays on buttons and chips; player bar with the song on the left, controls in the center and times on both sides of the progress bar; Apple Music-style "Now Playing" with a blurred cover and large title). Page backgrounds (home, cover-based gradients on albums and playlists) stay as in YT Music. Toggle it from the tray: *ByTune theme*.
- `src/chrome.css`: removes the Windows title bar; the app's top bar drags the window. Always applied.
- CSS only, no extra JS in the page where possible: no `backdrop-filter`, transitions only on `transform`/`opacity`, `content-visibility` for off-screen content, and the background blur is done on a 64×64 px image scaled on the GPU.
- Playlist covers in the sidebar (like Spotify): `src/covers.js` runs in the page with your session, fetches your library's playlists and returns each cover; they are saved so they show instantly on the next launch and refreshed every 15 minutes.
- Resizable sidebar (240–420 px) and queue (280–480 px): drag their edge; double-click resets it; widths are remembered.
- Spotify-style albums and playlists (cover and large title header, big play button, track list up to 1400 px wide); Now Playing queue pinned to the right; centered search box that never overlaps the top-bar icons; "back" button in the top bar.
- Live iteration: `YTM_DEBUG_PORT=9222 npm start` and `node scripts/cdp.mjs css src/theme.css` (also `shot`, `metrics`, `eval`, `click`); F5 reloads the CSS from disk.
- Checks: `node scripts/cdp.mjs overlaps` (player bar has no overlaps at several widths), `node scripts/cdp.mjs navcheck` (centered search box), `node scripts/cdp.mjs clipcheck` (no clipped text), `node scripts/test-like.mjs` (like / dislike with real clicks; undoes what it marks).

## Features

- The Google session is kept between restarts.
- Taskbar preview buttons (hover the taskbar icon): previous, play/pause, next.
- Tray icon: play/pause, next, previous, current song; click to show or hide.
- Closing the window keeps it in the tray (can be turned off from the tray menu).
- Notification on song change, "Start with Windows" option.
- Keyboard media keys and the Windows media panel (via Chromium).
- Quick menu (`Ctrl+Shift+Space` by default) to search songs, jump to playlists and control playback; settings menu under the gear icon.
- Global shortcuts: `Ctrl+Alt+→/←` next/previous, `Ctrl+Alt+M` show/hide. Play/pause: media key, or `Alt+↓` in the quick menu (`Alt+←/→` previous/next).
- In the window: `F5` reload, `Alt+←/→` back/forward, `Ctrl +/-/0` zoom.
- External links open in your browser.
- Remembers the window size and position.

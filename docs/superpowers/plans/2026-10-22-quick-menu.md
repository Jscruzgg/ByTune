# Quick Menu, Settings Menu and Translations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a keyboard-first floating quick menu (song search to play or queue, and library playlists and albums to open), a gear settings dropdown in the top bar, and Spanish/English UI text, to the Music Desktop Electron app.

**Architecture:**
- **Pure logic, testable without Electron.** Translations, shortcut handling, and library filtering go in small CommonJS modules under `src/lib/`. They're tested with Node's built-in `node --test` and need no new dependencies.
- **Talking to YouTube.** Calls that need the user's session go through one page-side script, `src/page-api.js`. It installs `window.__md` in the YouTube page, in the same way and with the same auth as `src/covers.js`. `main.js` calls it with `executeJavaScript`.
- **The quick menu** is its own small frameless, always-on-top `BrowserWindow` (`src/quickmenu/`). It's used in every mode, positioned over the app window when the app is focused, so there's only one implementation.
- **The settings dropdown** is drawn inside the YouTube page by `preload.js`, the same way it draws the back button. It talks to `main.js` over IPC.

**Tech Stack:** Electron 44, plain JS (CommonJS in main, browser JS in the windows), `node --test`, the existing `scripts/cdp.mjs` for live checks against the running app.

**Spec:** `docs/superpowers/specs/2026-10-22-quick-menu-design.md`. Approved mockups are in `.superpowers/brainstorm/755-1792701416/content/`: `quick-menu-v3.html` and `settings-menu-v2.html` (option A).

## Global Constraints

- No new runtime dependencies. Tests use `node --test`. Node 24 is installed, and the README requires 20 or later.
- The page and preload run with `contextIsolation: true` and `sandbox: true`. Keep both. A sandboxed preload can only `require('electron')`, so it can't `require` `src/lib/*`. It receives strings and settings over IPC instead.
- Performance rules (README *Interfaz*):
  - no `backdrop-filter`;
  - animate only `transform`/`opacity`;
  - no extra work in the page while the menus are closed. Re-use the existing 1 s `read()` loop in `preload.js`; don't add new timers or observers.
- Every new setting has a default in `defaults` in `src/main.js`, and every change is saved with `saveSettings()`. Defaults:
  - `quickMenu: { accelerator: 'CommandOrControl+Shift+Space', reach: 'focused', fromOtherApps: 'float', shiftEnter: 'queue' }`
  - `recent: []`
  - `library: []`
  - `lang: null`
- The shortcut must contain at least one of Ctrl, Alt, Shift, or Super, plus one non-modifier key. It must not equal any existing global shortcut: `CommandOrControl+Alt+Space`, `CommandOrControl+Alt+Right`, `CommandOrControl+Alt+Left`, `CommandOrControl+Alt+M`.
- Enter on a song plays it, which replaces the queue the same way clicking the song in YouTube's search does. Enter on a playlist or album opens its page without touching playback. Shift+Enter on a song runs `settings.quickMenu.shiftEnter`: `'queue'` adds it to the end of the queue, and `'next'` plays it next. Shift+Enter on a playlist or album does nothing.
- **Language rule:** if the code starts with `es`, use `es`; otherwise use `en`. Detection order:
  1. `settings.lang`, the last language detected;
  2. `app.getLocale()`;
  3. the page's `document.documentElement.lang`, once it's known. This one wins and is saved.
- **Visual style:** the dark minimalist panel from `quick-menu-v3.html`. Settings use the same style as the dropdown.
- **Comments and commit messages** are in Spanish, matching the existing code and git log.

## Review Focus

1. **Shortcut already taken.** In global mode, another program may already own the combination, so `globalShortcut.register` returns false. Expected behaviour: the old shortcut stays active, and the settings row shows the translated error. Covered in Task 2 (`validateAccelerator`) and Task 6 (live step).
2. **Fast typing.** Search responses can arrive out of order, and an older one must never replace newer results. Covered in Task 5 (`latestOnly` test).
3. **Signed out, offline, or page not loaded yet.** The menu still opens. Library and Recent show what's cached, and Songs is hidden instead of throwing. Covered in Task 3 (page API returns `{ error }`) and Task 5 (the renderer hides a section with an empty list).
4. **Changing reach or the shortcut while the app runs.** Moving from global back to focused unregisters the global shortcut. Changing the combination unregisters the old one, and the four existing global shortcuts keep working. Covered in Task 6 (`applyQuickMenuShortcut` live checks).
5. **Recent pointing at removed library items.** IDs that are no longer in the library are skipped and never rendered as blank rows. Covered in Task 2 (`recentItems` test).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/i18n.js` (new) | `STRINGS` table (`es`, `en`), `pickLang`, `t`. |
| `src/lib/shortcut.js` (new) | Shortcut recording, matching, validation, and display. |
| `src/lib/library.js` (new) | Filtering the cached library, managing the Recent list, and the page-to-ID mapping. |
| `src/page-api.js` (new) | Page-side script that installs `window.__md` with `library`, `searchSongs`, `play`, `queue`, and `open`. |
| `src/quickmenu/quickmenu.html`, `quickmenu.css`, `quickmenu.js`, `preload.js` (new) | The quick menu window. |
| `src/main.js` (modify) | Settings defaults, language, tray strings, page-API calls, the quick-menu window and shortcut, and settings IPC. |
| `src/preload.js` (modify) | Language reporting, translated back button, opened-page reporting, and the gear button with its dropdown. |
| `src/chrome.css` (modify) | Gear button and dropdown styles. They always apply, like the back button's. |
| `test/*.test.js` (new) | Unit tests for `src/lib/*`. |
| `scripts/cdp.mjs` (modify) | `apicheck` live command. |
| `package.json`, `README.md` (modify) | `test` script, and documentation of the feature. |

---

### Task 1: Translations, wired into the existing UI

**Files:**
- Create: `src/lib/i18n.js`, `test/i18n.test.js`
- Modify: `package.json` (add `"test": "node --test test/"`), `src/main.js` (tray labels at lines 184-205, `defaults`, the new `lang` IPC), and `src/preload.js` (back-button labels at lines 62-63, plus reporting the language).

**Interfaces:**
- Produces:
  - `pickLang(code: string | null | undefined) -> 'es' | 'en'`
  - `t(lang: 'es'|'en', key: string, vars?: Record<string,string>) -> string`. It replaces `{name}` placeholders. A missing key falls back to `en`, and then to the key itself.
  - `STRINGS: { es: Record<string,string>, en: Record<string,string> }`
  - In `main.js`: `let lang` (current language) and `stringsFor(lang) -> Record<string,string>` (just `STRINGS[lang]`).
  - IPC:
    - `ipcRenderer.send('lang', code)` from page preload to main;
    - `webContents.send('strings', { lang, strings })` from main to every renderer.
- **Keys every later task uses:**
  - Tray: `tray.play`, `tray.pause`, `tray.next`, `tray.previous`, `tray.show`, `tray.quit`.
  - Settings: `set.theme`, `set.notify`, `set.closeToTray`, `set.startWithWindows`, `set.quickMenu`, `set.shortcut`, `set.shortcutHint`, `set.shortcutTaken`, `set.shortcutInvalid`, `set.works`, `set.focused`, `set.anywhere`, `set.fromOtherApps`, `set.float`, `set.front`, `set.shiftEnter`, `set.queue`, `set.next`, `set.title`.
  - Back button: `nav.back`.
  - Quick menu: `qm.placeholder`, `qm.recent`, `qm.library`, `qm.songs`, `qm.playlist`, `qm.album`, `qm.added`, `qm.playingNext`, `qm.move`, `qm.playOpen`, `qm.queueHint`, `qm.close`.

  **Spanish text:**
  - The existing tray strings keep their current Spanish text ("Pausar", "Reproducir", "Siguiente", "Anterior", "Mostrar ventana", "Tema Music Desktop", "Notificar cambio de canción", "Cerrar a la bandeja", "Iniciar con Windows", "Salir").
  - `qm.placeholder` is "Buscar canciones o ir a una playlist…" in Spanish and "Search songs or jump to a playlist…" in English.
  - `set.shortcutTaken` is "Otro programa ya usa ese atajo" / "Another program already uses that shortcut".

- [ ] **Step 1: Write the failing tests** in `test/i18n.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { pickLang, t, STRINGS } = require('../src/lib/i18n');

test('pickLang: es* → es, everything else → en', () => {
  assert.equal(pickLang('es'), 'es');
  assert.equal(pickLang('es-419'), 'es');
  assert.equal(pickLang('ES-es'), 'es');
  assert.equal(pickLang('en-GB'), 'en');
  assert.equal(pickLang('pt-BR'), 'en');
  assert.equal(pickLang(null), 'en');
  assert.equal(pickLang(''), 'en');
});
test('both languages define exactly the same keys', () => {
  assert.deepEqual(Object.keys(STRINGS.es).sort(), Object.keys(STRINGS.en).sort());
});
test('t: fills placeholders and falls back', () => {
  assert.equal(t('es', 'tray.next'), 'Siguiente');
  assert.equal(t('en', 'tray.next'), 'Next');
  assert.equal(t('es', 'no.such.key'), 'no.such.key');
});
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL with `Cannot find module '../src/lib/i18n'`.
- [ ] **Step 3: Implement `src/lib/i18n.js`** with the keys listed above, in both languages.
- [ ] **Step 4: Run `npm test`.** Expected: 3 passing tests.
- [ ] **Step 5: Wire it into `main.js`.**
  - Set `lang = pickLang(settings.lang || app.getLocale())` before `createTray()`, and use `t(lang, …)` in `buildTrayMenu()`.
  - On `ipcMain.on('lang', (_e, code) => …)`:
    - if `pickLang(code)` differs from the current `lang`, update `lang`, save `settings.lang = lang`, and call `refreshUi()`;
    - always send `'strings'` to the page.
  - Also send `'strings'` on `dom-ready`.
- [ ] **Step 6: Wire it into `preload.js`.** Inside `read()`, send `ipcRenderer.send('lang', document.documentElement.lang)` only when the value changes. Store the strings received on `'strings'` and use `strings['nav.back']` for the back button's `title` and `aria-label`. Update the existing button when strings arrive.
- [ ] **Step 7: Live check.**
  - Run `YTM_DEBUG_PORT=9222 npm start`.
  - Run `node scripts/cdp.mjs eval "document.querySelector('.md-back').title"`. Expected: `"Atrás"` if your YouTube account is in Spanish, `"Back"` if it's in English.
  - Right-click the tray icon. The labels should be in the same language.
- [ ] **Step 8: Commit.** `git add src/lib/i18n.js test/i18n.test.js package.json src/main.js src/preload.js && git commit -m "Traducciones (español/inglés) según el idioma de YouTube Music"`

---

### Task 2: Shortcut and library helpers

**Files:**
- Create: `src/lib/shortcut.js`, `src/lib/library.js`, `test/shortcut.test.js`, `test/library.test.js`

**Interfaces:**
- Produces, in `shortcut.js`:
  - `RESERVED: string[]` (the four existing global accelerators).
  - `fromKeyEvent(e: { key: string, code?: string, ctrlKey|control: boolean, altKey|alt: boolean, shiftKey|shift: boolean, metaKey|meta: boolean }) -> string | null`.
    - It accepts both DOM `KeyboardEvent` objects and Electron `before-input-event` inputs.
    - It returns an Electron accelerator in a fixed order: `CommandOrControl`, `Alt`, `Shift`, `Super`, then the key.
    - It returns `null` while only modifiers are pressed.
    - Key names: `' '` → `Space`, single letters are uppercased, and arrows become `Up/Down/Left/Right`. Other names (`F1`…`F24`, digits, `Enter`, `Tab`, and so on) pass through as they are.
  - `validateAccelerator(acc: string | null) -> { ok: true } | { ok: false, reason: 'invalid' | 'reserved' }`. It's invalid when there's no modifier or no key. It's reserved when the accelerator is in `RESERVED`.
  - `matches(input, acc: string) -> boolean`, which is `fromKeyEvent(input) === acc`.
  - `displayAccelerator(acc: string) -> string`, for example `'CommandOrControl+Shift+Space'` → `'Ctrl + Shift + Space'`. `Super` displays as `Win`.
- Produces, in `library.js`. A `LibraryItem` is `{ id: string /* browseId: 'VL…' playlist, 'MPRE…' album */, type: 'playlist'|'album', title: string, artist?: string, cover: string }`.
  - `filterLibrary(items: LibraryItem[], query: string, limit = 5) -> LibraryItem[]`.
    - Matching ignores case and accents (NFD, with combining marks removed).
    - Order: titles that start with the query first, then titles containing it, keeping the original order within each group.
    - An empty query returns `[]`.
  - `pushRecent(recent: string[], id: string, libraryIds: Set<string>, max = 6) -> string[]`.
    - The new ID goes to the front, and duplicates are removed.
    - An ID that's not in `libraryIds` returns `recent` unchanged.
  - `recentItems(recent: string[], items: LibraryItem[], limit = 6) -> LibraryItem[]`.
    - It maps IDs to items and skips IDs that are missing.
    - If the result is empty, it falls back to `items.slice(0, limit)`.
  - `idFromUrl(url: string) -> string | null`.
    - `https://music.youtube.com/playlist?list=PLx` → `'VLPLx'`.
    - `…/browse/MPREb_abc` → `'MPREb_abc'`.
    - Anything else → `null`.

- [ ] **Step 1: Write the failing tests.**

  `test/shortcut.test.js`:
  - `fromKeyEvent({key:' ', ctrlKey:true, shiftKey:true})` → `'CommandOrControl+Shift+Space'`.
  - `fromKeyEvent({key:'k', control:true, alt:true})` → `'CommandOrControl+Alt+K'`. This is the Electron input form.
  - `fromKeyEvent({key:'Shift', shiftKey:true})` → `null`.
  - `validateAccelerator('Space')` → `{ok:false, reason:'invalid'}`.
  - `validateAccelerator('CommandOrControl+Alt+M')` → `{ok:false, reason:'reserved'}`.
  - `validateAccelerator('CommandOrControl+Shift+Space')` → `{ok:true}`.
  - `displayAccelerator('CommandOrControl+Shift+Space')` → `'Ctrl + Shift + Space'`.
  - `matches({key:' ', control:true, shift:true}, 'CommandOrControl+Shift+Space')` → `true`.

  `test/library.test.js`. Use `items` with these titles: "Chill Sunday" (playlist), "Más chill" (playlist), "Chill Vibes" (album), and "Focus".
  - `filterLibrary(items,'chill').map(i=>i.title)` → `['Chill Sunday','Chill Vibes','Más chill']`.
  - `filterLibrary(items,'mas')` → finds "Más chill".
  - `filterLibrary(items,'')` → `[]`.
  - `pushRecent(['b','a'],'a',new Set(['a','b']))` → `['a','b']`.
  - `pushRecent(['a'],'x',new Set(['a']))` → `['a']`.
  - `pushRecent(['1','2','3','4','5','6'],'7',ids)` → length 6, with `'7'` first.
  - **Review Focus 5:** `recentItems(['gone','VLa'], items)` returns only the item with ID `VLa`.
  - `recentItems([], items, 2)` → the first 2 items.
  - `idFromUrl('https://music.youtube.com/playlist?list=PL1')` → `'VLPL1'`.
  - `idFromUrl('https://music.youtube.com/browse/MPREb_x')` → `'MPREb_x'`.
  - `idFromUrl('https://music.youtube.com/')` → `null`.

- [ ] **Step 2: Run `npm test`.** Expected: FAIL with "Cannot find module".
- [ ] **Step 3: Implement both modules** to the signatures above.
- [ ] **Step 4: Run `npm test`.** Expected: all tests pass.
- [ ] **Step 5: Commit.** `git add src/lib test && git commit -m "Utilidades de atajos y biblioteca para el menú rápido"`

---

### Task 3: Page API (library, song search, play, queue, open)

**Files:**
- Create: `src/page-api.js`
- Modify: `src/main.js` (adds `pageApi(call, ...args)` and library caching), `scripts/cdp.mjs` (adds the `apicheck` command)

**Interfaces:**
- `src/page-api.js` is a page-world script with the same shape as `covers.js`. It's idempotent, meaning it's safe to run more than once. It installs `window.__md` with these methods, each returning a promise:
  - `library() -> { items: LibraryItem[] } | { error: string }`. This covers playlists (`FEmusic_liked_playlists`, with continuations up to 10 pages) and albums (`FEmusic_liked_albums`, same paging). Each item has its cover, title, type, and, for albums, the artist.
  - `searchSongs(q: string) -> { songs: Song[] } | { error: string }`.
    - `Song` is `{ videoId, title, artist, duration, cover }`.
    - It returns up to 5 songs.
    - It calls `/youtubei/v1/search` with the songs-only filter `params`. Use the value YouTube Music's own "Songs" chip sends; capture it once from the network tab and hard-code it with a comment.
  - `play(videoId) -> { ok: true } | { error }`. Same effect as clicking a song in YouTube's search: the queue is replaced with that song plus radio. The page must not reload.
  - `queue(videoId, position: 'end'|'next') -> { ok: true } | { error }`. This is YouTube's "Add to queue" or "Play next". The current song isn't interrupted.
  - `open(browseId) -> { ok: true } | { error }`. Opens the album or playlist page inside the app without reloading. Playback continues.
- **How play, queue, and open work** is left to the builder (see the spec). The approach must go through YouTube's own command/navigation handling on `ytmusic-app`, not `location.href` changes. Pull the SAPISIDHASH `browse` helper out of `covers.js` into `page-api.js`, and have `covers.js` use `window.__md.browse` when it's present, so there's only one copy of the auth helper.
- In `main.js`:
  - `pageApi(call: string, ...args) -> Promise<any>`. It runs `page-api.js` once per document (track this through `dom-ready`), then runs ``executeJavaScript(`window.__md.${call}(...${JSON.stringify(args)})`, true)``. When `win` is missing or anything throws, it resolves to `{ error }` and never rejects.
  - `refreshLibrary()` saves `settings.library = items` when the result has items. Call it 4 s after `dom-ready` and every 15 min, next to `refreshCovers`.

- [ ] **Step 1: Add the `apicheck` command to `scripts/cdp.mjs`.** It should:
  1. evaluate `page-api.js`;
  2. call `__md.library()` and assert there's at least one item with `id`, `type`, `title`, and `cover`, and that albums have `artist`;
  3. call `__md.searchSongs('daft punk')` and assert there are 1 to 5 songs, each with a `videoId` and a `duration` matching `/^\d+:\d\d/`;
  4. print `apicheck OK`, or exit with code 1 and print the failing assertion.
- [ ] **Step 2: Run it against the running app** (`YTM_DEBUG_PORT=9222 npm start`, then `node scripts/cdp.mjs apicheck`). Expected: FAIL, because `page-api.js` doesn't exist.
- [ ] **Step 3: Implement `src/page-api.js`, then `pageApi` and `refreshLibrary` in `main.js`.**
- [ ] **Step 4: Run `node scripts/cdp.mjs apicheck`.** Expected: `apicheck OK`.
- [ ] **Step 5: Check play, queue, and open by hand through `cdp.mjs eval`:**
  - `__md.queue('<id>','end')` keeps the current song playing, and the song appears last in the queue.
  - `__md.open('<an album id>')` shows the album and the same song keeps playing.
  - `__md.play('<id>')` starts that song.
  - **Review Focus 3:** in a signed-out session (or a private partition), `__md.searchSongs('x')` returns `{error}` and doesn't throw.
- [ ] **Step 6: Commit.** `git add src/page-api.js src/covers.js src/main.js scripts/cdp.mjs && git commit -m "API en la página: biblioteca, búsqueda de canciones, reproducir, cola y abrir"`

---

### Task 4: Quick menu window (UI and keyboard)

**Files:**
- Create: `src/quickmenu/quickmenu.html`, `quickmenu.css`, `quickmenu.js`, `src/quickmenu/preload.js`

**Interfaces:**
- **The preload exposes `window.qm`** through `contextBridge`:
  - `query(text) -> Promise<{ seq, library, songs }>`
  - `activate(item: { kind: 'song'|'playlist'|'album', id: string /* videoId or browseId */ }, shift: boolean) -> Promise<{ keepOpen: boolean, note?: 'added'|'playingNext' }>`
  - `close()`
  - `onShow(cb({ strings, recent: LibraryItem[] }))`
- **`quickmenu.js` owns the UI state.** On each `onShow` it:
  - clears the input and focuses it;
  - renders Recent with the `qm.*` strings.

  **While typing:**
  - Library results come back from `query` every time. Song search is debounced by main, not by the renderer.
  - `quickmenu.js` exports `latestOnly(fn)` for testability. It wraps an async function so that only the newest call's result is delivered and older ones are dropped. The renderer uses it around `qm.query`.

  **Keys:**
  - `↑`/`↓` move the selection through one flat list across sections, and the list wraps.
  - `Enter` calls `activate(item, false)`. `Shift+Enter` calls `activate(item, true)`, but only for songs.
  - `Esc` calls `close()`.
  - When `activate` returns `keepOpen` with a `note`, a muted note (`qm.added` or `qm.playingNext`) shows on that row for 1.5 s.

  **Rows:**
  - Each row shows a 32 px cover, the title, and right-aligned muted details:
    - playlist: `qm.playlist`
    - album: `` `${qm.album} · ${artist}` ``
    - song: `` `${artist} · ${duration}` ``
  - Sections with no items aren't rendered.
  - The footer shows the four key hints.
- The visuals copy `quick-menu-v3.html`: panel width 540, radius 16, inset search field, plain section labels, selected row `#2c2c2c`, and footer key caps. The window background is transparent and the panel draws its own shadow.

- [ ] **Step 1: Write a failing test for `latestOnly`** in `test/latest-only.test.js`. Make `quickmenu.js` export it under CommonJS when `module` exists, so it can be required in Node.

  Test `'drops stale results'`:
  - Call the wrapped function with `'a'`, whose result resolves after 30 ms, then with `'ab'`, which resolves after 5 ms.
  - Assert that the delivered results are only `['ab']`.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement the four files.** `latestOnly` must make the test pass.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Visual check.**
  - Open `src/quickmenu/quickmenu.html` directly in a browser with a stub `window.qm` that returns fixed data.
  - Compare it to `quick-menu-v3.html` (A: empty state with Recent; B: "chill" with Library and Songs).
  - Keyboard check: arrows wrap, Esc calls `close`, and Shift+Enter on a playlist does nothing.
- [ ] **Step 6: Commit.** `git add src/quickmenu test/latest-only.test.js && git commit -m "Ventana del menú rápido: interfaz y teclado"`

---

### Task 5: Quick menu wiring in main (open, query, activate, recent)

**Files:**
- Modify: `src/main.js`, `src/preload.js` (report opened pages)

**Interfaces:**
- Consumes:
  - from Task 1: `t`, `stringsFor`, `lang`;
  - from Task 2: `filterLibrary`, `pushRecent`, `recentItems`, `idFromUrl`;
  - from Task 3: `pageApi`, `settings.library`;
  - from Task 4: the IPC channel names below.
- Produces:
  - **`showQuickMenu(fromOutside: boolean)` / `hideQuickMenu()` / `toggleQuickMenu(fromOutside)`** in `main.js`.
    - The window is created lazily on first use and reused afterwards. It's `frame:false`, `transparent:true`, `alwaysOnTop:true`, `skipTaskbar:true`, `resizable:false`, and `show:false`.
    - It hides on `blur`.
    - **Position:**
      - if `win` is visible and focused, or if `fromOutside` with `fromOtherApps === 'front'` (after `showWindow()`): centered horizontally over `win`, 80 px below its top;
      - otherwise: centered on the display under the cursor (`screen.getDisplayNearestPoint(screen.getCursorScreenPoint())`), at 20% of its height.
  - **IPC `qm:query`.**
    - It returns the library results immediately: `filterLibrary(settings.library, text)`.
    - Songs come from `pageApi('searchSongs', text)`, debounced 200 ms in main. When the search fails it returns `songs: []`.
    - Every reply carries the request's `seq`.
  - **IPC `qm:activate`.**
    - **Song, no Shift:** `pageApi('play', id)`, then hide.
    - **Song, Shift:** `pageApi('queue', id, settings.quickMenu.shiftEnter === 'next' ? 'next' : 'end')`. Return `{ keepOpen: true, note: shiftEnter === 'next' ? 'playingNext' : 'added' }`.
    - **Playlist or album:** `pageApi('open', id)`, hide, and if `win` isn't visible, call `showWindow()`.
  - **Recent.**
    - `preload.js` sends `ipcRenderer.send('opened', location.href)` from `read()` when `location.href` changes.
    - `main.js` runs `idFromUrl`, then `pushRecent` against the library IDs, and saves.
    - The menu receives `recentItems(settings.recent, settings.library)` when it's shown.

- [ ] **Step 1: Implement all of the above.** For now, use a temporary hardcoded in-window trigger in `before-input-event`: `matches(input, settings.quickMenu.accelerator)` calls `toggleQuickMenu(false)`. Task 6 replaces it.
- [ ] **Step 2: Live check in the running app.**
  1. Press `Ctrl+Shift+Space`. The menu appears over the app, and Recent shows library items.
  2. Type "chill". Library matches appear instantly, and songs about 200 ms later.
  3. Press Enter on a song. It plays and the menu closes.
  4. Reopen the menu and press Shift+Enter on a song. The current song keeps playing, the "Added to queue" note shows, and the song is last in the queue.
  5. Press Enter on an album. The album page opens and the same song keeps playing.
  6. Reopen the menu. That album is first in Recent.
  7. Type quickly and then delete back to one letter. The results match the final text (Review Focus 2).
- [ ] **Step 3: Commit.** `git add src/main.js src/preload.js && git commit -m "Menú rápido conectado: búsqueda, reproducir, cola, abrir y recientes"`

---

### Task 6: Gear button, settings dropdown, and shortcut modes

**Files:**
- Modify: `src/preload.js` (gear and dropdown), `src/chrome.css` (styles), `src/main.js` (settings IPC, shortcut registration, tray sync)

**Interfaces:**
- Consumes:
  - from Task 1: the `set.*` strings;
  - from Task 2: `fromKeyEvent`, `validateAccelerator`, `displayAccelerator`, `matches`;
  - from Task 5: `toggleQuickMenu`.
- Produces:
  - IPC:
    - `ipcRenderer.invoke('settings:get')` returns `{ theme, notifications, closeToTray, startWithWindows, quickMenu, display: { shortcut } }`.
    - `ipcRenderer.invoke('settings:set', patch)` returns the same shape, or `{ error: 'taken'|'invalid'|'reserved' }` for a rejected accelerator.
  - **`applyQuickMenuShortcut(next) -> 'ok'|'taken'|'invalid'|'reserved'`** in `main.js`:
    - It always unregisters the previous quick-menu global accelerator, and never calls `unregisterAll`.
    - If `reach === 'global'`, it registers `next.accelerator` with `toggleQuickMenu(!win || !win.isFocused())`. If that fails, it re-registers the previous one and returns `'taken'`.
    - Focused mode is handled by the `matches` check in `before-input-event`, plus the same check inside the quick-menu window, so pressing the shortcut again closes it.
    - The settings are saved only on `'ok'`.
  - **Tray sync:** a change from either the tray or the dropdown saves the setting and calls `refreshUi()`. When the dropdown is open, it gets `settings:changed`.
- **Dropdown behaviour (`preload.js`).**
  - **Gear button:**
    - `button.md-gear` is inserted in `ytmusic-nav-bar #right-content` before the avatar button. It's added in `read()`, the same way `ensureBackButton` works.
    - It's `-webkit-app-region: no-drag`, a 36 px circle, and its `title` is `set.title`.
  - **The panel** is `div.md-settings`, placed under the gear.
    - It closes on `Esc`, on a click outside, or on a second gear click.
    - Its rows are: "Quick menu" (current shortcut plus a chevron), a divider, and four switches (`set.theme`, `set.notify`, `set.closeToTray`, `set.startWithWindows`).
  - **Clicking "Quick menu" toggles an indented sub-block** in place (option A). The sub-block contains:
    - **The Shortcut row.** Clicking it enters recording mode and shows `set.shortcutHint`.
      - The next `keydown` that produces a non-null `fromKeyEvent` is sent with `settings:set`.
      - `Esc` cancels.
      - An error result shows `set.shortcutTaken` or `set.shortcutInvalid` under the row and keeps the old value.
    - **Works:** radios for `set.focused` / `set.anywhere`.
    - **From other apps:** radios for `set.float` / `set.front`. These are disabled and shown at 40% opacity unless the reach is `anywhere`.
    - **Shift+Enter on a song:** radios for `set.queue` / `set.next`.
  - While the dropdown is recording, keydowns must not reach YouTube. Call `preventDefault` and `stopPropagation` in a capture listener.
- **Styles (`chrome.css`):**
  - The panel is `#1c1c1c` with a `#2e2e2e` border, radius 14, padding 6, and width 320.
  - Rows have radius 8 and use `#2c2c2c` on hover.
  - Switches are 30×18 and white when on.
  - The sub-block is indented with a 1 px `#333` left border.
  - Opening fades with `opacity` and `transform` only.

- [ ] **Step 1: Implement `applyQuickMenuShortcut` and the settings IPC in `main.js`,** and remove Task 5's temporary trigger in favour of it. Call it at startup after the existing `globalShortcut.register` lines.
- [ ] **Step 2: Implement the gear, the dropdown, and its styles.**
- [ ] **Step 3: Live check in the running app.**
  1. The gear sits between cast and the avatar, at both a wide and a narrow window width (`node scripts/cdp.mjs overlaps` still passes).
  2. Toggling each switch changes the tray checkbox, and the reverse works too.
  3. Choose "From anywhere". The shortcut now works from Notepad. With "Float on its own", the app window stays hidden. With "Bring app to front", the window comes up with the menu over it.
  4. Switch back to "Only when focused". The shortcut no longer works from Notepad, and `Ctrl+Alt+Space` still plays and pauses (Review Focus 4).
  5. Record `Ctrl+Alt+M`. The reserved error shows. Record a bare `K`: nothing is accepted, and the error shows. Record `Ctrl+Shift+K`: the row shows `Ctrl + Shift + K` and it works.
  6. **Review Focus 1:** in global mode, record a combination another running program already holds (for example `Ctrl+Shift+Esc`, which Windows reserves). The "taken" message shows and the previous shortcut still works.
- [ ] **Step 4: Run `npm test`** to make sure the unit tests still pass. Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/main.js src/preload.js src/chrome.css && git commit -m "Botón de ajustes con menú desplegable y modos del atajo del menú rápido"`

---

### Task 7: Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the *Funciones* list** with the quick menu (default `Ctrl+Shift+Space`, Enter/Shift+Enter/Esc), the gear menu and its options, and the fact that the app's text follows YouTube Music's language (Spanish or English).
- [ ] **Step 2: Under *Interfaz*, document the new files** (`src/lib/`, `src/page-api.js`, `src/quickmenu/`), `npm test`, and `node scripts/cdp.mjs apicheck`.
- [ ] **Step 3: Commit.** `git add README.md && git commit -m "README: menú rápido, ajustes y traducciones"`

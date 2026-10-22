# Quick menu and settings menu: design

Date: 2026-10-22. Status: draft for approval.

## Why

Music Desktop is an Electron wrapper around music.youtube.com (`src/main.js`, `src/preload.js`, CSS themes, `src/covers.js`). Two everyday actions need the mouse today:

- searching for a song;
- opening one of your saved playlists or albums.

The goal is a keyboard-first floating launcher, similar to Spotlight or Raycast. You press a configurable shortcut, type, choose with the arrow keys, and press Enter. Success means you can search and play a song, or jump to a library playlist or album, without touching the mouse.

A second, related problem is that every app setting is hidden in the tray icon's right-click menu. The quick menu brings new settings (the shortcut and how it behaves), so the app also gets a visible settings menu inside the window.

## Goals

1. **A quick menu that opens with a configurable keyboard shortcut.**
2. **Song search** from YouTube Music, the same results the main search bar would give. Enter on a song **plays it**.
3. **Library jump**: type a few letters to filter your saved playlists and albums. Enter **opens that page** (the album or playlist view) and does **not** change the song that's playing.
4. **Playing a library song directly from the menu** (a nice-to-have from the user).
5. **A gear button in the top bar** that opens a settings dropdown holding the quick-menu options and the four existing tray settings.
6. **Spanish and English UI text** for everything the app draws itself, following the language YouTube Music is using (see Translations).

The rule for Enter is fixed: **Enter on a song plays it, and Enter on an album or playlist opens it.** Songs also have one secondary action: **`Shift+Enter` adds the song to the queue** without interrupting what's playing (see Keys). Albums and playlists have no secondary action.

## Non-goals

- Downloaded/offline songs. The YouTube Music website has no downloads (only the phone app does), so there's nothing to search.
- A "Go to" section for app pages such as Home, Explore, or Library. It was considered, and the user went with the design without it. It can be added later.
- A dedicated settings page or window.
- Artists, videos, or podcasts in the menu. The only queue action is the configurable `Shift+Enter` on a song.
- Removing the tray menu's settings. They stay there as well.

## Anti-goals (would make it a failure even if it "works")

- **Needing the mouse anywhere in the main flow.** That covers opening the menu, typing, moving, choosing, and closing.
- **A cluttered look.** The menu must stay minimalist (see Visual design). There are no per-row action tags like "Play" or "Open".
- **Opening a playlist or album and interrupting the current song.**
- **Slowing down the main app.** The project deliberately keeps JS in the page minimal (see the README section *Interfaz*). The menu must cost nothing while it's closed.
- **An overwhelming settings menu.** Rarely changed options must stay folded away.

## Quick menu: behaviour

### Opening and closing
- The shortcut opens the menu with the cursor already in the search field. Pressing the shortcut again, pressing `Esc`, or clicking outside the menu closes it.
- After Enter on a result, the menu closes.
- **Reach setting** (user-configurable):
  - **Only when the app is focused** (default). The shortcut works only while the Music Desktop window is the active window.
  - **From anywhere** (global). The shortcut works from any program.
- **Behaviour when opened from another app** (applies only to "From anywhere"; user-configurable):
  - **Float on its own** (default). The menu appears on top of whatever you're doing. The Music Desktop window stays where it is, even if minimized or hidden in the tray. Playing a song happens in the background. Opening a playlist or album brings the app window up on that page, since there's no other way to see it.
  - **Bring the app to the front**. The app window is restored and focused, and the menu opens on top of it.
- When the app is already focused, the menu always appears over the app window, centered horizontally near the top, regardless of these settings.

### Empty state (nothing typed)
A **Recent** section lists the **library** playlists and albums you opened most recently, newest first, up to about 6. "Recently opened" counts pages opened anywhere in the app, not only through the menu, but **only items saved in your library are recorded** (decided by the user). Recent stores only IDs. The name, cover, and type come from the cached library list, and anything you remove from your library also disappears from Recent. With no history yet, it falls back to the first library playlists and albums.

### Typing
Results update as you type, in two sections:
1. **Library**: your saved playlists and albums whose names match the text. This is filtered locally from a cached list, so it's instant. Up to about 5 results.
2. **Songs**: results from YouTube Music's song search. Up to about 5 results, fetched after a short pause in typing so the menu doesn't send a request on every key.

Empty sections are hidden. The first result is selected automatically.

### Keys
- `↑` / `↓` move the selection across both sections.
- `Enter` plays the song or opens the playlist or album. It works like clicking a song in YouTube Music's own search: the current queue is replaced by that song followed by YouTube's automatic radio.
- `Shift+Enter` on a song adds it to the queue without interrupting the current song. By default this is **"Add to queue"** (end of the queue). In settings it can be changed to **"Play next"** (right after the current song). The menu stays open with your text still there, and the row briefly shows a muted "Added to queue" or "Playing next" note, so you can queue several songs in a row. `Shift+Enter` does nothing on playlists and albums.
- `Esc` closes the menu.

## Quick menu: visual design

Approved mockup: `.superpowers/brainstorm/755-1792701416/content/quick-menu-v3.html`. It's based on a launcher the user built for another app.

- A dark, rounded panel (about 540 px wide, radius about 16 px) with a soft shadow, matching the app's dark theme.
- An **inset search field** with its own rounded, slightly lighter background and a magnifier icon. Placeholder text: "Search songs or jump to a playlist…".
- A thin divider under the field.
- **Plain section labels** in muted text and sentence case: "Recent", "Library", "Songs". No uppercase labels.
- **Rows**: a 32 px rounded cover image, the name, and muted details pushed to the right:
  - playlist: `Playlist`
  - album: `Album · Artist`
  - song: `Artist · 2:57`
- The selected row has a rounded, slightly lighter background.
- **A footer with key hints**: `↑↓ move`, `Enter play / open`, `Shift+Enter queue`, `Esc close`, shown as small key caps.
- Cover images are required for every row.

## Settings menu

Approved mockup: `.superpowers/brainstorm/755-1792701416/content/settings-menu-v2.html`, **option A**.

- **A gear button** in the YouTube Music top bar, between the cast button and the profile picture. It's added the same way `preload.js` adds the back button today.
- Clicking it opens a **dropdown under the gear**, drawn inside the page in the same style as the quick menu. It's not a native Windows menu, because a native menu can't record a key combination. It closes on `Esc`, on a click outside it, or when the gear is clicked again.
- Contents when closed:
  1. **Quick menu** row, showing the current shortcut and a chevron.
  2. A divider.
  3. **Music Desktop theme**, an on/off switch.
  4. **Notify on song change**, an on/off switch.
  5. **Close to tray**, an on/off switch.
  6. **Start with Windows**, an on/off switch.
- **Clicking "Quick menu" unfolds its options in place** (option A), pushing the rows below it down:
  - **Shortcut**: shows the current combination. Click it, then press the new combination to save it. `Esc` cancels. It must include at least one modifier key (Ctrl, Alt, Shift, or Win). If it can't be registered (for example, another program already uses it), keep the old one and show a short message in the row.
  - **Works**: "Only when the app is focused" or "From anywhere" (radio choice).
  - **From other apps**: "Float on its own" or "Bring app to front" (radio choice). This group is greyed out and disabled unless "From anywhere" is selected.
  - **Shift+Enter on a song**: "Add to queue" (default) or "Play next" (radio choice).
- Every change applies immediately and is saved in `settings.json`. The tray menu and the gear menu always show the same values.

## Translations

Requested by the user after learning that labels are hardcoded in Spanish while YouTube Music follows the Google account's language.

- **Two languages: Spanish and English.** Every piece of text the app draws itself uses translated strings:
  - the quick menu (placeholder, section labels, details such as "Playlist" and "Album", the "Added to queue" and "Playing next" notes, the footer hints);
  - the settings dropdown (every label and the shortcut error message);
  - the **existing** tray menu, the back button's tooltip and aria-label, the gear button's tooltip, and the window title's "YouTube Music" fallback, which is a brand name and can stay as is.
- **The language follows YouTube Music**, meaning the language of the page the user sees (for example the page's `<html lang>`, or the `hl` value in YouTube's config). If it starts with `es`, use Spanish; otherwise use English. Before the page has loaded, and while the tray is built at startup, use the system locale (`app.getLocale()`) with the same rule. Then switch once the page's language is known. The language that was last detected is saved in `settings.json`, so the next startup is right from the first frame.
- **No language setting in the gear menu.** It follows YouTube. Changing YouTube's language changes the app's text after the next page load.
- The strings live in one small shared table with `es` and `en` entries, so that adding a language later means adding one block. Text from YouTube itself (song, playlist, and album names) is never translated.
- The README stays as it is (Spanish). That's out of scope.

## Constraints and facts from the codebase

- Settings live in `settings.json` in userData (`defaults` in `src/main.js`), and every new setting needs a default there.
- Global shortcuts already exist and use Electron's `globalShortcut` (`Ctrl+Alt+Space`, `Ctrl+Alt+→/←`, `Ctrl+Alt+M`). A new default must not clash with them.
- In-window keys are handled in `before-input-event` in `src/main.js`.
- The page runs with `contextIsolation` and `sandbox`. `preload.js` sees the DOM but not YouTube's JS objects. Anything that needs the user's YouTube session, such as API calls, runs in the page through `webContents.executeJavaScript`, the way `src/covers.js` does. `covers.js` already shows how to call YouTube Music's internal API (`/youtubei/v1/browse` with SAPISIDHASH auth) and how to page through the library playlists (`FEmusic_liked_playlists`).
- Performance rules from the README: no `backdrop-filter`, animate only `transform`/`opacity`, and keep page JS minimal.
- Today all of the app's own UI text is hardcoded in Spanish: the tray menu in `src/main.js`, the back button's `'Atrás'` in `src/preload.js`, and the window title. There's no translation system yet (see Translations). Labels in this document are written in English for discussion only.
- The window has no native title bar; `chrome.css` makes the top bar draggable. The gear button must stay clickable, like the existing back button.

## Decided by the assistant (user may override)

- **Default shortcut:** `Ctrl+Shift+Space`. **Default reach:** only when the app is focused. **Default "from other apps":** float on its own.
- **Recent** holds up to about 6 IDs, stored in `settings.json`.
- **Enter on a song replaces the queue** with that song plus YouTube's radio, like clicking it in YouTube's search. This is a review call made because keeping the old queue would mean driving YouTube's queue directly, which is fragile. To keep the current queue, use `Shift+Enter`.
- **After `Shift+Enter` the menu stays open**, with an inline note on the row.
- **"Play a library song"** is covered by the Songs section, which is YouTube Music's own song search. Searching your library's songs separately is left out of the first version. If the user wants liked songs searched locally too, it can be added as another source in the Library section.
- **Tray settings stay in the tray** as well as in the gear menu.
- The settings dropdown is drawn inside the page and is not a native menu, so it can record shortcuts.
- `.superpowers/` gets added to `.gitignore`.
- **Translations:** languages other than Spanish fall back to English. The language is detected from YouTube's page, not set by the user. The README is not translated.

## Left to the builder

- **How the floating menu is drawn.** A small frameless, transparent, always-on-top `BrowserWindow` would work for the "float on its own" mode, because the main window may be hidden. Whether the same window is also used in-app, or an in-page overlay is used there, is up to the builder, as long as both look the same.
- **How to search songs and play one** without reloading the page. Possible approaches are YouTube Music's internal search endpoint with a songs filter, and navigating the existing page so playback continues seamlessly.
- **How saved albums are fetched**, alongside playlists. For example, the library albums browse ID can reuse `covers.js`'s pattern. The builder also decides how often the cached list is refreshed; covers currently refresh every 15 minutes.
- **How "recently opened" is detected**, for example by watching navigation to playlist or album pages.
- Exact sizes, debounce timing, and result counts, within the visual design above.
- How the translation table is shared between the main process, preload, and the menu windows, and exactly which YouTube signal is read for the language.
- **Tests or checks** in the style of `scripts/cdp.mjs`.

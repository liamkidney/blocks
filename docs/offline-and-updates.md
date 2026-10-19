# Offline play and update policy

Blocks is an offline-first progressive web app (PWA).

- The installed application shell (HTML, scripts, CSS, icons, manifest) is
  pre-cached atomically by the service worker. A failed installation does not
  replace the current working version.
- Game requests use the cached version first, with an online fallback only for
  unexpectedly missing assets. Runtime Supabase requests are never cached by
  the worker and are not required for gameplay.
- Updates can download in the background while the game is open. A new service
  worker does **not** call skipWaiting during installation.
- A worker already waiting when a fresh page loads is explicitly activated,
  and that page reloads once so its scripts all come from the same release.
  A worker found later must wait; it cannot interrupt a current game.
- Saved game snapshots remain in localStorage and are keyed by app URL and mode.
- Score updates go into a separate persistent localStorage outbox before any
  network call. Completed and abandoned sessions cannot become active again.
  Supabase writes are retried when online, and each session has a stable ID.
- The high-score leaderboard is an online feature; game play is not.
- Production and development have separate service worker caches, PWA IDs and
  scopes, created by scripts/build-pages.mjs. The GitHub dev -> main fast-forward
  release policy is unchanged.

The installed Home Screen app must finish its first load online to cache its
assets. Browser storage eviction by the operating system can still prevent an
offline launch; PWA storage is not a substitute for a native app installation.

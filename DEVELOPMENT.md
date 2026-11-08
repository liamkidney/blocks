# Development

> **Maintenance:** Read this file before development. Keep it updated alongside code changes to reflect current architecture, known issues and future plans. Remove outdated information.

## Project

Blocks is an install-to-play falling-block PWA with solo play, two players on one device and live two-phone multiplayer. The detailed feature, protocol and release documentation is in [README.md](README.md); offline/update behaviour is in [docs/offline-and-updates.md](docs/offline-and-updates.md).

## Architecture

- **Gameplay:** `game.js`, `tetrominoes.js`, `game-modes.js`, `session.js`; `app.js` owns the main UI and game input.
- **Controls:** `control-layout.js` is the single source of button order, storage, validation and placement. Solo portrait editing lives in `app.js`; `multiplayer.js` reuses the same buttons for the second local player. One saved layout applies to all game modes on that installation.
- **Two-phone play:** `remote-multiplayer.js` uses Supabase RPCs and Realtime; `push-client.js` and `sw.js` handle installed-PWA friend invitations and notification recovery.
- **PWA and releases:** `sw.js` caches the app shell; `scripts/build-pages.mjs` generates separate dev/prod builds and icon colours (dev blue, prod red).

## Development rules

- **Work on `dev` only.** Do not alter `main` or release to production without explicit approval.
- Keep implementations simple and shared where possible; do not introduce mode-specific duplicates of preferences or UI components.
- Add regression tests and require the `Validate Blocks Dev` and Pages workflows to succeed. Run `node --test tests/*.test.cjs` for the complete JavaScript suite.
- Promote the **exact validated `dev` commit** with GitHub Actions **Promote validated Dev to Main**; preserve linear ancestry. See [README.md](README.md#branches-and-releases).
- Update this backlog and any affected architectural notes in the same commit.

## Current verification and known issues

- **Notification tap reliability:** The dev branch includes fallback app reopening after iOS focus failure, recovery after cold starts and a race-condition fix for saved invitation handoffs. Automated tests pass; **real iPhone testing remains outstanding**, including backgrounded, suspended and closed-app cases.
- **Control order:** Refactored to a shared model; automated tests pass. **Verify on physical devices** that rearrangement persists after app restart, across solo/two-phone modes, and for both stations in one-phone multiplayer.
- Treat other bugs as unconfirmed until reproduced; record new findings here with steps to reproduce.

## Backlog

Only record work explicitly requested or deferred by the project owner. Separate suggestions from agreed work.

### Verification — recent changes

- [ ] Test push-notification taps on real iPhones with Blocks open, backgrounded and relaunched; preserve active games until the player chooses to join.
- [ ] Test saved control order across game modes, restarts and reconnects.

### User-requested development

- [ ] **Responsive game layout:** Review whether the requested fundamental simplification is complete, including the iPad title being cut off and support for different screen sizes and orientations. Resolve any remaining defects rather than adding CSS patches.
- [ ] **Settings colours:** Add customisable colours (explicitly mentioned for later; design not yet specified).
- [ ] **Separate Supabase environments:** Revisit the previously deferred separation of development and production databases when prioritised.

Do not add assistant-proposed features to this backlog without user approval.

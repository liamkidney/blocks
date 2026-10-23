# Blocks

A lightweight falling-block puzzle game for the web.

Play in a modern browser using the on-screen controls, touch gestures, or keyboard arrow keys.

## Branches and releases

All changes are made on `dev`; `main` is the last released, validated dev commit. Production is published at https://liamkidney.github.io/blocks/ and development at https://liamkidney.github.io/blocks/dev/.

Run tests and validate the development PWA before releasing. To promote, run GitHub Actions → **Promote validated Dev to Main** on `main`. The workflow verifies Git ancestry, tests and builds the exact dev SHA, then fast-forwards main without generating new application commits. The Pages pipeline deploys both channels after the successful release workflow. Never commit directly to main, use cherry-picks, or squash/rebase a release. Production and development differ only in generated URLs, PWA titles, optional development inspectors, revision stamps and cache isolation.

## Two-phone multiplayer (development)

Open https://liamkidney.github.io/blocks/dev/?remote=1 on both phones, or select
**2 players · two phones** in the new-game selector on the dev site. Player 1 chooses
**Create match** and shares the six-letter code. Player 2 chooses **Join match**,
enters the code and starts immediately; Player 1 starts automatically when joined.

- Each phone runs a separate local board and independently randomises pieces.
- Clearing two lines sends one junk row; extra cleared-line progress carries forward.
  This is the same attack rule as one-phone multiplayer.
- Supabase stores room state, result, and attack events, **not the two full boards**.
  Anonymous database writes require a player-specific secret token.
- Supabase Realtime broadcasts lightweight wake-ups; token-validated RPC reads apply
  the actual attack events, with 1.6-second polling as a fallback.
- Event keys are idempotent and the sender keeps a durable retry outbox. The receiver
  saves its board snapshot and event cursor together so reconnecting does not replay
  previously applied junk.
- A returning player on the same device can reconnect from the lobby. Room access
  expires after 12 hours. Matchmaking requires an internet connection.
- Matches do not submit scores to the single-player leaderboard. The production
  site only changes through the existing validated dev-to-main promotion workflow.

Backend schemas:
- supabase/migrations/20261023_two_phone_matches.sql
- supabase/migrations/20261023_two_phone_realtime.sql

Tests: node --test tests/*.test.cjs, including tests/remote-multiplayer.test.cjs.

# Blocks

A lightweight falling-block puzzle game for the web.

Play in a modern browser using the on-screen controls, touch gestures, or keyboard arrow keys.

## Branches and releases

All changes are made on `dev`; `main` is the last released, validated dev commit. Production is published at https://liamkidney.github.io/blocks/ and development at https://liamkidney.github.io/blocks/dev/.

Run tests and validate the development PWA before releasing. To promote, run GitHub Actions → **Promote validated Dev to Main** on `main`. The workflow verifies Git ancestry, tests and builds the exact dev SHA, then fast-forwards main without generating new application commits. The Pages pipeline deploys both channels after the successful release workflow. Never commit directly to main, use cherry-picks, or squash/rebase a release. Production and development differ only in generated URLs, PWA titles, optional development inspectors, revision stamps and cache isolation.

## Two-phone multiplayer (development)

Play at https://liamkidney.github.io/blocks/dev/?remote=1 on both phones,
or choose **2 players · two phones** in the development new-game selector.

1. **Create game** displays a six-letter room code, with a loading indicator while the room is created.
2. **Join game** displays six empty letter positions. Entering the sixth letter joins automatically, without a separate submit step.
3. After joining, **both devices display Ready to Start** with the session's current wins tally. The first Start press marks that player as ready and waits for the second; the game begins only after **both players press Start**.
4. Each player controls **their own independent board**. Clearing two lines sends one junk line to the other player, with odd-line progress carried forward exactly as in the one-phone mode.
5. The finished board remains on screen behind a **You win / You lose** result panel, which shows **matches won: You vs Opponent**. Each completed round increments the winner's tally once.
6. Both players can press **Play again**. The first waits; when the second accepts, both receive a new independent board and a clean attack state **without resetting wins**, using the same room, code and player tokens.
7. The **×** on the initial Ready, result or **Ready to Play Again** panel exits to **Create game / Join game**. It cancels the old room so the opponent is returned to matchmaking rather than left waiting. Creating a new room starts a new 0–0 session.

The transport uses Supabase Realtime wake-ups plus 1.6-second polling fallback,
with token-validated RPCs and durable, idempotent attack messages scoped to each
round. Each device persists its board and event cursor for reconnection.
Room access expires after 12 hours. Internet is required for matchmaking and
live multiplayer. Multiplayer scores never enter the solo leaderboard.

Migrations:
- `supabase/migrations/20261023_two_phone_matches.sql`
- `supabase/migrations/20261023_two_phone_realtime.sql`
- `supabase/migrations/20261023_two_phone_rematches.sql`
- `supabase/migrations/20261023_two_phone_result_exit.sql`
- `supabase/migrations/20261023_two_phone_start_and_session_wins.sql`
- `supabase/migrations/20261023_two_phone_backfill_wins.sql`

Tests: `node --test tests/*.test.cjs`, including
`tests/remote-multiplayer.test.cjs`. Development is promoted to production
only using the validated linear `dev` → `main` workflow.

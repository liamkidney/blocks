# Blocks

A lightweight falling-block puzzle game for the web.

Play in a modern browser using the on-screen controls, touch gestures, or keyboard arrow keys.

## Branches and releases

All changes are made on `dev`; `main` is the last released, validated dev commit. Production is published at https://liamkidney.github.io/blocks/ and development at https://liamkidney.github.io/blocks/dev/.

Run tests and validate the development PWA before releasing. To promote, run GitHub Actions → **Promote validated Dev to Main** on `main`. The workflow verifies Git ancestry, tests and builds the exact dev SHA, then fast-forwards main without generating new application commits. The Pages pipeline deploys both channels after the successful release workflow. Never commit directly to main, use cherry-picks, or squash/rebase a release. Production and development differ only in generated URLs, PWA titles, optional development inspectors, revision stamps and cache isolation.

## Two-phone multiplayer (development)

Play at https://liamkidney.github.io/blocks/dev/?remote=1 on both phones,
or choose **2 players · two phones** in the development new-game selector.

1. **Create game** displays a **three-consonant code** with a three-minute countdown and NATO phonetic labels directly beneath the three letters. A small server-side denylist excludes offensive abbreviations; codes use the 21 letters B–Z excluding A, E, I, O and U (including Z).
2. **Join game** shows three letter positions with matching NATO labels as each letter is typed. Any typed characters, including vowels and Z, are kept rather than blocked or silently filtered. After three characters the client asks the server to find the room; codes that were never generated are simply unavailable. No submit button is needed. A generated code can be used only once and must be joined within three minutes.
3. After joining, **both devices display Ready to Start** with the session's current wins tally. The first Start press marks that player as ready and waits for the second; the game begins only after **both players press Start**.
4. Each player controls **their own independent board**. Clearing two lines sends one junk line to the other player, with odd-line progress carried forward exactly as in the one-phone mode.
5. The finished board remains on screen behind a **You win / You lose** result panel, which shows **matches won: You vs Opponent**. Each completed round increments the winner's tally once.
6. Both players can press **Play again**. The first waits; when the second accepts, both receive a new independent board and a clean attack state **without resetting wins**, using the same room, code and player tokens.
7. The **×** on the initial Ready, result or **Ready to Play Again** panel exits to **Create game / Join game**. It cancels the old room so the opponent is returned to matchmaking rather than left waiting. Creating a new room starts a new 0–0 session.

The transport uses Supabase Realtime wake-ups plus 1.6-second polling fallback,
with token-validated RPCs and durable, idempotent attack messages scoped to each
round. Each device persists its board and event cursor for reconnection.
Internet is required for matchmaking and live multiplayer.
Multiplayer scores never enter the solo leaderboard.

### Reliability and competitive fairness (dev updates)

- Game difficulty and allowed pieces are chosen by the **room creator** and
  stored by Supabase. The guest's board adopts the same speed and piece set;
  optional visual preferences remain local.
- Guest joins carry a random idempotency token. An interrupted HTTP reply can
  be safely retried, including after reloading the app. Three-letter join attempts
  are throttled to five per detected client address in three minutes and forty
  attempts globally per minute, with only hashed client identifiers retained.
- **Short invitation ≠ match lifetime.** Each code expires three minutes after
  issuance and is consumed on join. The host sees a countdown; if a code
  expires without a guest joining, the room returns to matchmaking. A successful
  join remains valid through games and rematches, independently of code expiry.
  The backend keeps six-letter internal room identifiers and unchanged legacy
  RPCs to support the production release.
- The waiting-for-player code screen has an **×** that cancels the room.
  A stale exit from an earlier round is rejected, so it cannot end a rematch.
- Opt-in heartbeat tracking for new rooms pauses both local boards if either
  phone goes offline or is backgrounded. Presence is checked every 1.6 s;
  missing heartbeats become offline after 9 s. A player still online wins
  if the opponent remains disconnected for 75 s. Reconnection resumes play
  without losing already acknowledged attacks.
- Active rooms extend their rolling 12-hour expiry on authenticated heartbeat.
  Expired room records are removed after a further 24-hour grace period by a
  daily Supabase pg_cron job (03:17 UTC).
- Anonymous room creation across old and new endpoints is limited to 60
  new rooms per minute globally. This is basic abuse protection, not per-IP
  enforcement.

**Compatibility:** rooms created by the production release retain the
previous protocol and do not opt into new heartbeat forfeit semantics.

Migrations:
- `supabase/migrations/20261023_two_phone_matches.sql`
- `supabase/migrations/20261023_two_phone_realtime.sql`
- `supabase/migrations/20261023_two_phone_rematches.sql`
- `supabase/migrations/20261023_two_phone_result_exit.sql`
- `supabase/migrations/20261023_two_phone_start_and_session_wins.sql`
- `supabase/migrations/20261023_two_phone_backfill_wins.sql`
- `supabase/migrations/20261023_guard_stale_round_exit.sql`
- `supabase/migrations/20261023_match_rules_and_reliable_join.sql`
- `supabase/migrations/20261023_match_presence_and_ttl.sql`
- `supabase/migrations/20261023_room_pruning_and_rate_cap.sql`
- `supabase/migrations/20261023_schedule_room_cleanup.sql`
- `supabase/migrations/20261023_short_consonant_invites.sql`
- `supabase/migrations/20261023_expire_short_invite.sql`

Tests: `node --test tests/*.test.cjs`, including
`tests/remote-multiplayer.test.cjs`. Run
`supabase/tests/multiplayer_smoke.sql` and
`supabase/tests/short_invites_smoke.sql` in the Supabase SQL editor for
transactional integration checks. Development is promoted to production
only using the validated linear `dev` → `main` workflow.

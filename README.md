# Blocks

A lightweight falling-block puzzle game for the web.

Play in a modern browser using the on-screen controls or touch gestures. Standard games draw pieces from a **shuffled seven-piece bag**, containing exactly one of each tetromino per bag; the restricted I/O mode shuffles those two allowed pieces. Partially used bags survive saving and reconnection.

## Branches and releases

All changes are made on `dev`; `main` is the last released, validated dev commit. Production is published at https://liamkidney.github.io/blocks/ and development at https://liamkidney.github.io/blocks/dev/.

Run tests and validate the development PWA before releasing. To promote, run GitHub Actions → **Promote validated Dev to Main** on `main`. The workflow verifies Git ancestry, tests and builds the exact dev SHA, then fast-forwards main without generating new application commits. The Pages pipeline deploys both channels after the successful release workflow. Never commit directly to main, use cherry-picks, or squash/rebase a release. Production and development differ only in generated URLs, PWA titles, optional development inspectors, revision stamps and cache isolation.

## New Game navigation and Settings (development)

- **New Game** first asks how to play: **Play Solo**, **Two Players · One Phone**
  or **Play Together · Two Phones**. **High Scores** and **Settings** are
  accessible without starting a game.
- Solo and one-phone games next choose **speed** and **ghost piece** before
  starting. **Play Together** goes straight to its own menu; neither setting
  is requested from a joining player.
- **Back** always uses the left-facing arrow and returns one level; **X**
  closes a dialog or cancels/leaves an allocated room. Unfinished code-entry
  attempts are retained only for retrying a code the player types explicitly;
  they never auto-open **Join Game** when entering **Play Together**.
- **Create Game** and **Invite Friend** both show the host a short game-rules
  screen (speed, allowed pieces and ghost piece) *before* allocating a room.
  **Join Game** and push invitations inherit these host-authored rules.
  **Ready to Start** displays them to both players.
- **Ghost piece is an intentionally shared competitive rule**, not a personal
  visual setting. The host's choice is synchronised to both phones, including
  rematches and reconnects. Settings only supplies the host's default.
- **Settings** allows editing the existing leaderboard/friends nickname,
  default speed and ghost preference. In installed PWAs it also manages
  friends and notification permission. A renamed player keeps the same
  leaderboard ID and their push installation's display name is refreshed.
  Future control order, handedness and appearance options can live here.
- The Settings entry is available from the New Game menu, the solo game's
  HUD and the Play Together menu. No personal friends or notification
  controls appear in Safari or ordinary browser tabs.

## Push-only invitations (development)

Friend invitations use **Web Push**, not shared URLs. The manual three-letter room
code remains available for playing with someone for the first time.

Friendship controls and push registration are available **only while running the
installed standalone PWA**. Safari and other ordinary browser tabs show only
the existing multiplayer and room-code UI. **Play Together** offers **Create Game**,
**Join Game**, and **Invite Friend** (only when saved friends exist). Choosing
**Invite Friend** opens the friends list before any room is created. Backing
out leaves no room. Choosing a friend creates the room, sends a push, and
shows a waiting screen without irrelevant manual code controls.

To remove a friend, open **Settings → Friends**, tap **Remove** beside
their name, and confirm. The invitation picker is only for inviting people.
Removing a friend revokes invitations in both directions and clears mutual
friend requests from previous matches. If no friends remain, **Invite Friend**
disappears.

1. After a completed match, either player can select **Add Friend**. The request
   is mutual: the two installations become saved friends only if both accept.
   BLOCKS reuses the exact player ID and nickname already used for the solo
   leaderboard; unnamed players choose a nickname once.
2. When the friendship is confirmed, **Enable Notifications** registers this
   installation for Web Push. On iPhone, install **Blocks Dev** to the Home Screen,
   open it from the icon, and grant permission when prompted. No Apple developer
   account or personal sign-in is needed.
3. Next time, the host taps **Invite Friend** on **Play Together** and selects
   a saved friend. Only then is a room created and a push sent. If delivery
   fails, the newly created room is cancelled. Tapping the notification opens
   the **installed PWA** directly into the **Ready to Start** screen.
4. Notification invitations currently respect the original **three-minute**
   waiting-room expiry. A connected match and subsequent rematches still live
   independently of that short expiry. The friend cannot be invited while
   notifications are off.

The backend stores per-installation secret digests, mutual friend relationships,
subscriptions and VAPID keys in private RLS-protected tables. The private VAPID
key is never included in the public application. Push transport and installation
behaviour must be validated on real devices; automated tests do not simulate APNs.

## Two-phone multiplayer (development)

Play at https://liamkidney.github.io/blocks/dev/?remote=1 on both phones,
or choose **Play Together · Two Phones** from the development New Game menu.

1. **Create Game** first lets the host confirm **speed**, **pieces** and
   **ghost piece** for both players. Confirming allocates a room and shows
   a **three-consonant code** with a three-minute countdown. A single centred NATO
   line appears beneath the full code, e.g. `bravo - delta - lima`. A small server-side denylist excludes offensive abbreviations; codes use the 21 letters B–Z excluding A, E, I, O and U (including Z).

2. **Join game** shows only three letter positions, without NATO text. Any typed characters, including vowels and Z, are kept rather than blocked or silently filtered. After three characters the client asks the server to find the room; codes that were never generated are simply unavailable. No submit button is needed. A generated code can be used only once and must be joined within three minutes.
3. After joining, **both devices display Ready to Start** with the session's current wins tally. The first Start press marks that player as ready and waits for the second; the game begins only after **both players press Start**.
4. Each player controls **their own independent board**. Clearing two lines sends one junk line to the other player, with odd-line progress carried forward exactly as in the one-phone mode. Every junk row has **4–7 randomly positioned filled blocks** and **3–6 gaps**. In two-phone mode, the HUD displays a small **OPPONENT** board beneath NEXT instead of Score and Lines. All occupied cells, including the opponent's falling piece, use the same grey colour. The profile, leaderboard and top room/forfeit bar are absent in this mode. Four equally sized HUD buttons provide **Pause**, **Restart (forfeit)**, **❤️**, and **😭**. Either player can pause the match, and both must release their own pause before play resumes. Emoji buttons can be tapped repeatedly, including while paused. Each tap briefly pulses its button, and the emoji floats upwards on **both** the sender's board (immediately) and the opponent's board (on receipt). Reactions are paced rather than discarded, with a short bounded retry queue for WebSocket reconnects. Opponent board frames, pause signals and reactions use the existing Realtime socket; none are saved as database records.
5. The finished board remains on screen behind a **You win / You lose** result panel, which shows **matches won: You vs Opponent**. Each completed round increments the winner's tally once.
6. Both players can press **Play again**. The first waits; when the second accepts, both receive a new independent board and a clean attack state **without resetting wins**, using the same room, code and player tokens.
7. On the initial **Ready to Start** panel, **×** leaves the room. After a completed match, **×** or tapping outside the results popup instead dismisses it to reveal the frozen final board, without ending the session or changing rematch readiness. The **restart icon** stays in the HUD and reopens the popup so players can choose **Play again**. **Leave room** in the result popup explicitly cancels the session, returning both players to matchmaking. Creating a new room starts a new 0–0 session.

The transport uses Supabase Realtime wake-ups plus 1.6-second polling fallback,
with token-validated RPCs and durable, idempotent attack messages scoped to each
round. Each device persists its board and event cursor for reconnection.
Internet is required for matchmaking and live multiplayer.
Multiplayer scores never enter the solo leaderboard.

### Reliability and competitive fairness (dev updates)

- Game difficulty, allowed pieces and **Ghost Piece** are chosen by the **room creator** and
  stored by Supabase. The guest's board adopts all three rules, including after reconnecting
  and during rematches. A guest's saved solo preference remains unchanged.
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
- `supabase/migrations/20261025_host_ghost_piece.sql`

Tests: `node --test tests/*.test.cjs`, including
`tests/remote-multiplayer.test.cjs`. Run
`supabase/tests/multiplayer_smoke.sql` and
`supabase/tests/short_invites_smoke.sql` in the Supabase SQL editor for
transactional integration checks. Development is promoted to production
only using the validated linear `dev` → `main` workflow.

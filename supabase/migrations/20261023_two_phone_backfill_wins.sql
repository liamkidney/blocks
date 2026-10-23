-- Preserve wins in multiplayer rooms created before session scoreboard columns
-- existed. Lost events identify exactly one winner per completed round.
-- GREATEST makes the migration idempotent and never discards newer wins.
with completed as (
  select e.match_id,
    count(*) filter(where e.sender=2) as host_wins,
    count(*) filter(where e.sender=1) as guest_wins
  from public.blocks_match_events e
  where e.event_type='lost'
  group by e.match_id
)
update public.blocks_matches m
set host_wins=greatest(m.host_wins,c.host_wins::integer),
    guest_wins=greatest(m.guest_wins,c.guest_wins::integer)
from completed c
where m.id=c.match_id
  and (m.host_wins<c.host_wins or m.guest_wins<c.guest_wins);
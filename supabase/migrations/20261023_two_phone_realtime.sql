-- Low-latency wake-ups for two-phone Blocks matches.
-- Payload contains only a row identifier; match details still require the
-- private player token through blocks_match_poll().
create or replace function public.blocks_notify_match_event()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform realtime.send(
    pg_catalog.jsonb_build_object('event_id',new.id),
    'changed',
    'blocks-match-' || new.match_id::text,
    false
  );
  return new;
end $$;

drop trigger if exists blocks_match_event_notify on public.blocks_match_events;
create trigger blocks_match_event_notify
  after insert on public.blocks_match_events
  for each row execute function public.blocks_notify_match_event();

create or replace function public.blocks_notify_match_status()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform realtime.send(
    pg_catalog.jsonb_build_object('status',new.status),
    'changed',
    'blocks-match-' || new.id::text,
    false
  );
  return new;
end $$;

drop trigger if exists blocks_match_status_notify on public.blocks_matches;
create trigger blocks_match_status_notify
  after update of status on public.blocks_matches
  for each row when (old.status is distinct from new.status)
  execute function public.blocks_notify_match_status();

revoke all on function public.blocks_notify_match_event() from public;
revoke all on function public.blocks_notify_match_status() from public;
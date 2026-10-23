-- Two-phone Blocks match protocol (development).
-- Apply to the shared Supabase project before enabling the client UI.
-- Players keep their boards locally; only attacks and match state are persisted.
create table if not exists public.blocks_matches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z]{6}$'),
  host_token uuid not null default gen_random_uuid(),
  guest_token uuid,
  status text not null default 'waiting'
    check (status in ('waiting','playing','finished','cancelled')),
  winner smallint check (winner in (0,1,2)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '12 hours')
);
create table if not exists public.blocks_match_events (
  id bigint generated always as identity primary key,
  event_key uuid not null,
  match_id uuid not null references public.blocks_matches(id) on delete cascade,
  sender smallint not null check (sender in (1,2)),
  event_type text not null check (event_type in ('attack','lost')),
  rows smallint check (rows between 1 and 20),
  created_at timestamptz not null default now(),
  check ((event_type='attack' and rows is not null) or (event_type='lost' and rows is null))
);
create unique index if not exists blocks_match_events_idempotency
  on public.blocks_match_events(match_id,sender,event_key);
create index if not exists blocks_match_events_match_id_id
  on public.blocks_match_events(match_id,id);
create index if not exists blocks_matches_expires_at on public.blocks_matches(expires_at);

alter table public.blocks_matches enable row level security;
alter table public.blocks_match_events enable row level security;
-- No direct anonymous table access. All access is through token-checked RPCs.
revoke all on public.blocks_matches from anon, authenticated;
revoke all on public.blocks_match_events from anon, authenticated;

create or replace function public.blocks_create_match()
returns table(match_id uuid, room_code text, player_token uuid)
language plpgsql security definer set search_path = ''
as $$
declare m public.blocks_matches%rowtype; candidate text; attempt integer;
begin
  for attempt in 1..20 loop
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + (get_byte(decode(replace(gen_random_uuid()::text,'-',''),'hex'),n) % 24), 1),'')
      into candidate from generate_series(0,5) n;
    insert into public.blocks_matches(code) values(candidate)
      on conflict(code) do nothing returning * into m;
    exit when m.id is not null;
  end loop;
  if m.id is null then raise exception 'Unable to allocate room code'; end if;
  return query select m.id,m.code,m.host_token;
end $$;

create or replace function public.blocks_join_match(p_code text)
returns table(match_id uuid, player_token uuid)
language plpgsql security definer set search_path = ''
as $$
declare m public.blocks_matches%rowtype; token uuid := gen_random_uuid();
begin
  update public.blocks_matches
  set guest_token=token,status='playing',updated_at=now()
  where code=upper(trim(p_code)) and status='waiting' and expires_at>now()
  returning * into m;
  if m.id is null then raise exception 'Room unavailable or already joined'; end if;
  return query select m.id,token;
end $$;

create or replace function public.blocks_match_poll(p_match uuid,p_token uuid,p_after bigint default 0)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare m public.blocks_matches%rowtype;
begin
  select * into m from public.blocks_matches where id=p_match
    and (host_token=p_token or guest_token=p_token) and expires_at>now();
  if m.id is null then raise exception 'Match not found or access denied'; end if;
  return jsonb_build_object(
    'status',m.status,'winner',m.winner,
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'sender',e.sender,'type',e.event_type,'rows',e.rows) order by e.id)
      from public.blocks_match_events e where e.match_id=m.id and e.id>p_after),'[]'::jsonb)
  );
end $$;

create or replace function public.blocks_match_send(p_match uuid,p_token uuid,p_type text,p_rows integer default null,p_key uuid default null)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare m public.blocks_matches%rowtype; sender_no smallint; event_id bigint;
begin
  select * into m from public.blocks_matches where id=p_match
    and (host_token=p_token or guest_token=p_token) and expires_at>now() for update;
  if m.id is null or m.status<>'playing' then raise exception 'Match not active'; end if;
  sender_no := case when m.host_token=p_token then 1 else 2 end;
  if p_key is null then raise exception 'Missing event id'; end if;
  if not ((p_type='attack' and p_rows between 1 and 20) or (p_type='lost' and p_rows is null))
    then raise exception 'Invalid event'; end if;
  insert into public.blocks_match_events(match_id,sender,event_type,rows,event_key)
    values(p_match,sender_no,p_type,p_rows,p_key)
    on conflict(match_id,sender,event_key) do nothing returning id into event_id;
  if event_id is null then
    select id into event_id from public.blocks_match_events
      where match_id=p_match and sender=sender_no and event_key=p_key;
    return event_id;
  end if;
  if p_type='lost' then
    update public.blocks_matches set status='finished',winner=3-sender_no,updated_at=now() where id=p_match;
  end if;
  return event_id;
end $$;

revoke all on function public.blocks_create_match() from public;
revoke all on function public.blocks_join_match(text) from public;
revoke all on function public.blocks_match_poll(uuid,uuid,bigint) from public;
revoke all on function public.blocks_match_send(uuid,uuid,text,integer,uuid) from public;
grant execute on function public.blocks_create_match() to anon,authenticated;
grant execute on function public.blocks_join_match(text) to anon,authenticated;
grant execute on function public.blocks_match_poll(uuid,uuid,bigint) to anon,authenticated;
grant execute on function public.blocks_match_send(uuid,uuid,text,integer,uuid) to anon,authenticated;

-- Short, pronounceability-reduced invitations for two-phone Blocks.
-- Existing six-letter rooms/RPCs remain intact for current production.
-- The public code is only an invitation; UUID player tokens authorize play.
--
-- Room rows retain a six-letter internal code for compatibility with legacy
-- clients; short codes are allocated separately and can be reused after join
-- or expiry without resetting the 12-hour match/session lifecycle.

alter table public.blocks_matches
  add column if not exists short_code text
    check (short_code is null or short_code ~ '^[BCDFGHJKLMNPQRSTVWXYZ]{3}$');

create table if not exists public.blocks_short_invites (
  code text primary key check (code ~ '^[BCDFGHJKLMNPQRSTVWXYZ]{3}$'),
  match_id uuid not null unique
    references public.blocks_matches(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists blocks_short_invites_expiry
  on public.blocks_short_invites(expires_at);

-- A small, editable moderation denylist. This reduces, but cannot guarantee
-- the absence of, culturally offensive abbreviations.
create table if not exists public.blocks_short_code_denylist (
  code text primary key check (code ~ '^[BCDFGHJKLMNPQRSTVWXYZ]{3}$')
);
insert into public.blocks_short_code_denylist(code) values
  ('FCK'),('FKN'),('FKS'),('CNT'),('SHT'),('WTF'),('KKK'),('KYS'),
  ('NGR'),('JZZ'),('DCK'),('PRN'),('PNS'),('XXX'),('BCH'),
  ('PSS'),('TWT'),('SXY'),('FNG'),('FKR')
on conflict do nothing;

-- Count *failed and successful* attempts without storing the raw IP.
-- Failed requests return a normal JSON error object so the database
-- transaction commits the attempt, rather than rolling back the counter.
create table if not exists public.blocks_short_join_attempts (
  id bigint generated always as identity primary key,
  client_hash text not null,
  attempted_at timestamptz not null default now()
);
create index if not exists blocks_short_join_attempts_time
  on public.blocks_short_join_attempts(attempted_at);
create index if not exists blocks_short_join_attempts_ip
  on public.blocks_short_join_attempts(client_hash,attempted_at);

alter table public.blocks_short_invites enable row level security;
alter table public.blocks_short_code_denylist enable row level security;
alter table public.blocks_short_join_attempts enable row level security;
revoke all on public.blocks_short_invites from anon,authenticated;
revoke all on public.blocks_short_code_denylist from anon,authenticated;
revoke all on public.blocks_short_join_attempts from anon,authenticated;

create or replace function public.blocks_create_match_short(
  p_difficulty integer,p_piece_set text)
returns table(match_id uuid,room_code text,player_token uuid,code_expires_at timestamptz)
language plpgsql security definer set search_path=''
as $$
declare
  created record;
  allocated public.blocks_short_invites%rowtype;
  candidate text;
  attempt integer;
begin
  -- Reuse existing production-compatible creation safeguards and settings.
  select * into created
    from public.blocks_create_match_config(p_difficulty,p_piece_set);
  if created.match_id is null then
    raise exception 'Unable to create game';
  end if;

  delete from public.blocks_short_invites
    where expires_at<=now();

  for attempt in 1..35 loop
    select string_agg(
      pg_catalog.substr('BCDFGHJKLMNPQRSTVWXYZ',
        1+get_byte(decode(replace(gen_random_uuid()::text,'-',''),'hex'),n)%21,1),
      '' order by n)
    into candidate from generate_series(0,2) as n;

    if exists(select 1 from public.blocks_short_code_denylist d
              where d.code=candidate) then
      continue;
    end if;

    insert into public.blocks_short_invites(code,match_id,expires_at)
      values(candidate,created.match_id,now()+interval '3 minutes')
      on conflict(code) do nothing
      returning * into allocated;
    exit when allocated.match_id is not null;
  end loop;
  if allocated.match_id is null then
    raise exception 'Unable to allocate room code; try again';
  end if;

  update public.blocks_matches
    set short_code=allocated.code
    where id=created.match_id;

  return query select created.match_id,allocated.code,created.player_token,
                      allocated.expires_at;
end $$;

-- Short codes are small enough to brute force. Enforce both client-address
-- and global rolling limits. The client address comes from platform request
-- headers, with a global limit as a fallback if header identity is absent.
-- Retry of an already-joined UUID does not consume another attempt.
create or replace function public.blocks_join_match_short(
  p_code text,p_join_token uuid)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  clean_code text:=pg_catalog.upper(pg_catalog.btrim(p_code));
  client_addr text;
  client_hash text;
  h jsonb;
  room public.blocks_matches%rowtype;
  invite public.blocks_short_invites%rowtype;
begin
  if p_code is null or p_join_token is null or
     clean_code !~ '^[BCDFGHJKLMNPQRSTVWXYZ]{3}$' then
    return jsonb_build_object('error','Enter a valid three-letter code.');
  end if;

  -- Idempotent retry after a successful join, even if its invite was consumed
  -- or expired. No other token is ever returned from this branch.
  select * into room from public.blocks_matches
    where short_code=clean_code and guest_token=p_join_token
      and status in ('ready','playing','finished') and expires_at>now();
  if room.id is not null then
    return jsonb_build_object('match_id',room.id,'player_token',p_join_token);
  end if;

  h:=coalesce(nullif(pg_catalog.current_setting('request.headers',true),'')::jsonb,
              '{}'::jsonb);
  client_addr:=coalesce(nullif(h->>'cf-connecting-ip',''),
      nullif(pg_catalog.btrim(pg_catalog.split_part(h->>'x-forwarded-for',',',1)),''),
      'unknown');
  client_hash:=pg_catalog.md5(client_addr);

  -- Serialize attempts so parallel guesses cannot bypass the cap.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('blocks-short-join-rate'));
  if (select count(*) from public.blocks_short_join_attempts
        where client_hash=client_hash
        and attempted_at>now()-interval '3 minutes')>=5
     or (select count(*) from public.blocks_short_join_attempts
        where attempted_at>now()-interval '1 minute')>=40 then
    return jsonb_build_object('error','Too many attempts. Try again shortly.');
  end if;

  insert into public.blocks_short_join_attempts(client_hash)
    values(client_hash);

  select * into invite from public.blocks_short_invites
    where code=clean_code and expires_at>now()
    for update;
  if invite.match_id is null then
    return jsonb_build_object('error','Room not found or code expired.');
  end if;

  update public.blocks_matches
    set guest_token=p_join_token,status='ready',
        host_ready=false,guest_ready=false,
        guest_seen_at=now(),updated_at=now()
    where id=invite.match_id and status='waiting'
      and guest_token is null and expires_at>now()
    returning * into room;

  if room.id is null then
    return jsonb_build_object('error','Room already joined or unavailable.');
  end if;
  -- Invite consumed immediately; the room and player UUIDs remain valid.
  delete from public.blocks_short_invites where code=clean_code;
  return jsonb_build_object('match_id',room.id,'player_token',p_join_token);
end $$;

revoke all on function public.blocks_create_match_short(integer,text) from public;
revoke all on function public.blocks_join_match_short(text,uuid) from public;
grant execute on function public.blocks_create_match_short(integer,text)
  to anon,authenticated;
grant execute on function public.blocks_join_match_short(text,uuid)
  to anon,authenticated;

-- The scheduled Blocks-only cleanup job also clears old attempt metadata.
create or replace function public.blocks_prune_expired_matches()
returns integer language plpgsql security definer set search_path=''
as $$
declare deleted_count integer;
begin
  delete from public.blocks_short_invites where expires_at<now();
  delete from public.blocks_short_join_attempts
    where attempted_at<now()-interval '10 minutes';
  delete from public.blocks_matches
    where expires_at<now()-interval '24 hours';
  get diagnostics deleted_count=row_count;
  return deleted_count;
end $$;
revoke all on function public.blocks_prune_expired_matches()
  from public,anon,authenticated;
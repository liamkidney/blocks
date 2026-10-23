-- The creator can safely retire an expired three-letter invitation.
-- Use invite-row -> match-row lock order, matching the join RPC, to avoid
-- deadlocks when someone joins in the final moments of the three-minute window.
create or replace function public.blocks_expire_short_invite(
  p_match uuid,p_token uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare inv public.blocks_short_invites%rowtype;
        m public.blocks_matches%rowtype;
begin
  select * into inv from public.blocks_short_invites
    where match_id=p_match for update;
  select * into m from public.blocks_matches
    where id=p_match and host_token=p_token
      and expires_at>now() for update;
  if m.id is null then raise exception 'Match not found or access denied'; end if;
  if m.status <> 'waiting' then
    return jsonb_build_object('status',m.status);
  end if;
  if inv.match_id is not null and inv.expires_at>now() then
    return jsonb_build_object('status','waiting','expires_at',inv.expires_at);
  end if;
  update public.blocks_matches
    set status='cancelled',host_ready=false,guest_ready=false,updated_at=now()
    where id=m.id;
  delete from public.blocks_short_invites where match_id=m.id;
  return jsonb_build_object('status','expired');
end $$;
revoke all on function public.blocks_expire_short_invite(uuid,uuid) from public;
grant execute on function public.blocks_expire_short_invite(uuid,uuid)
  to anon,authenticated;
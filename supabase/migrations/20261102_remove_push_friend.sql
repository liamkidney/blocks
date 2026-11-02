-- Removing a friend revokes mutual invitations and pending friend requests
-- from past games, so an old accepted request cannot silently recreate it.
create or replace function public.blocks_push_remove_friend(p_self uuid,p_friend uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare v_count integer;
begin
  if p_self is null or p_friend is null or p_self = p_friend then
    return false;
  end if;

  delete from public.blocks_push_friends
  where first_id = least(p_self,p_friend)
    and second_id = greatest(p_self,p_friend);
  get diagnostics v_count = row_count;
  if v_count = 0 then return false; end if;

  update public.blocks_push_pairs p
  set wants_friend = false, updated_at = now()
  where p.installation_id in (p_self,p_friend)
    and exists (
      select 1 from public.blocks_push_pairs other
      where other.match_id = p.match_id
        and other.installation_id =
          case when p.installation_id=p_self then p_friend else p_self end
    );
  return true;
end;
$$;
revoke all on function public.blocks_push_remove_friend(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.blocks_push_remove_friend(uuid,uuid) to service_role;

-- Permit student registration with any valid email address.
--
-- Public sign-up goes directly to Supabase Auth, so this trigger is the
-- authoritative account-default policy. Registration still cannot select a
-- department or a privileged role; only faculty requests require approval.

begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  requested_role text := new.raw_user_meta_data ->> 'requested_role';
begin
  insert into public.profiles (id, email, full_name, role, department, status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    case when requested_role = 'faculty' then 'faculty' else 'student' end,
    'CCSICT',
    case when requested_role = 'faculty' then 'pending' else 'approved' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Existing pending profiles are intentionally left unchanged: the schema does
-- not record whether an account was held by the prior domain policy or by an
-- administrator. Review and approve those accounts explicitly rather than
-- overriding an administrative status decision during migration.

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;

commit;

-- Hold self-registered accounts outside the institutional email domain for review.
--
-- 20260828_allow_any_email_signup.sql reverted 20260803's domain rule, so any
-- address on the internet became an approved student on sign-up and could read
-- the archive -- abstracts, advisers, panel names -- and chat with saved history
-- without anyone at ISU vouching for it (2026-11-25 review). This restores the
-- rule with the GRANT that 20260803 lacked and 20260828 added.
--
-- Off-domain accounts are held at 'pending', not rejected: a failure inside this
-- trigger would abort the auth.users insert and surface as an opaque sign-up
-- error, and legitimate exceptions exist (visiting researchers, campus
-- addresses on another domain). An administrator approves them from System
-- Management, the same path faculty requests already take.
--
-- The domain is read from the app.institutional_email_domain setting so a
-- deployment can change it without editing this function:
--   alter database postgres set app.institutional_email_domain = 'isu.edu.ph';
--
-- Only NEW sign-ups are affected; existing accounts keep their status.
-- Safe to apply repeatedly. Rollback: 20261126_institutional_signup_domain_gate.rollback.sql

begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  institutional_domain text := lower(coalesce(
    nullif(current_setting('app.institutional_email_domain', true), ''),
    'isu.edu.ph'
  ));
  requested_role text := new.raw_user_meta_data ->> 'requested_role';
  email_domain text := split_part(lower(coalesce(new.email, '')), '@', 2);
  -- The domain itself or any subdomain of it (e.g. a student mail subdomain).
  is_institutional boolean := email_domain = institutional_domain
    or email_domain like ('%.' || institutional_domain);
begin
  insert into public.profiles (id, email, full_name, role, department, status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    case when requested_role = 'faculty' then 'faculty' else 'student' end,
    'CCSICT', -- Public registration cannot self-assign another department.
    -- Faculty always needs review; so does anyone off the institutional domain.
    case
      when requested_role = 'faculty' then 'pending'
      when not is_institutional then 'pending'
      else 'approved'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;

commit;

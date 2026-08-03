-- Stop auto-approving accounts that are not on the institutional email domain.
--
-- handle_new_user granted status 'approved' to any address whatsoever, so anyone
-- on the internet could self-register and immediately read the CCSICT archive.
-- '@isu.edu.ph' existed only as placeholder text in the sign-up form and as a
-- client-side hint, neither of which is a control.
--
-- The trigger is the right place for this, not FastAPI: sign-up goes straight from
-- the browser to Supabase Auth and never traverses the API, so an application-side
-- check cannot see the request at all.
--
-- Off-domain accounts are held at 'pending' rather than rejected. A hard failure
-- inside this trigger would abort the auth.users insert and surface as an opaque
-- signup error, and legitimate exceptions do exist (visiting researchers, campus
-- addresses on another domain). Pending means an administrator decides, which is
-- the same path faculty requests already take.
--
-- The domain is read from the app.institutional_email_domain GUC so a deployment
-- can override it without editing this function:
--   alter database postgres set app.institutional_email_domain = 'isu.edu.ph';
--
-- Existing accounts are untouched. Safe to apply repeatedly.

begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  institutional_domain text := coalesce(
    nullif(current_setting('app.institutional_email_domain', true), ''),
    'isu.edu.ph'
  );
  requested_role text := new.raw_user_meta_data ->> 'requested_role';
  is_institutional boolean := lower(coalesce(new.email, '')) like ('%@' || lower(institutional_domain));
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

commit;

-- Backfill Supabase Auth accounts created before the profiles trigger existed.
-- Safe to rerun: existing profiles are preserved unchanged.

begin;

insert into public.profiles (id, email, full_name, role, department, status)
select
  users.id,
  users.email,
  coalesce(
    nullif(trim(users.raw_user_meta_data ->> 'full_name'), ''),
    split_part(coalesce(users.email, ''), '@', 1),
    'ISU User'
  ),
  case when users.raw_user_meta_data ->> 'requested_role' = 'faculty'
    then 'faculty' else 'student' end,
  'CCSICT',
  case when users.raw_user_meta_data ->> 'requested_role' = 'faculty'
    then 'pending' else 'approved' end
from auth.users as users
where not exists (
  select 1 from public.profiles as profiles where profiles.id = users.id
);

commit;

-- Follow-up correctness fixes for an already-applied 20260724 operations migration.
-- Preserves acknowledgement while an alert remains active and counts only
-- genuinely reopened alert episodes. Safe to apply repeatedly.

begin;

create or replace function public.upsert_operational_alert(
  p_dedupe_key text,
  p_alert_type text,
  p_severity text,
  p_safe_details jsonb default '{}'::jsonb
)
returns setof public.operational_alerts
language sql
security definer
set search_path = public
as $$
  insert into public.operational_alerts (
    dedupe_key, alert_type, severity, status, safe_details,
    occurrence_count, last_seen_at, updated_at, resolved_at
  ) values (
    left(p_dedupe_key, 160), left(p_alert_type, 120), p_severity,
    'open', coalesce(p_safe_details, '{}'::jsonb), 1, now(), now(), null
  )
  on conflict (dedupe_key) do update set
    alert_type = excluded.alert_type,
    severity = excluded.severity,
    status = case
      when public.operational_alerts.status = 'resolved' then 'open'
      else public.operational_alerts.status
    end,
    safe_details = excluded.safe_details,
    occurrence_count = public.operational_alerts.occurrence_count
      + case when public.operational_alerts.status = 'resolved' then 1 else 0 end,
    last_seen_at = now(),
    updated_at = now(),
    acknowledged_at = case
      when public.operational_alerts.status = 'resolved' then null
      else public.operational_alerts.acknowledged_at
    end,
    acknowledged_by = case
      when public.operational_alerts.status = 'resolved' then null
      else public.operational_alerts.acknowledged_by
    end,
    resolved_at = null
  returning *;
$$;

revoke all on function public.upsert_operational_alert(text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_operational_alert(text, text, text, jsonb)
  to service_role;

commit;

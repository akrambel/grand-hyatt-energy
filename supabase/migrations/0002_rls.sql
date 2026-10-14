-- =============================================================================
-- Migration 0002: Row Level Security, grants and realtime publication
--
-- Security model
--   * Nobody is anonymous: `anon` has no access to any table.
--   * Every signed-in, *active* user can read operational data.
--   * Administrators can write everything; regular users can enter daily
--     readings / daily metrics / LPG levels only when `can_enter_data` is true.
--   * Sensor rows are inserted exclusively by the `ingest` Edge Function using
--     the service role (which bypasses RLS). No client policy allows inserts.
--   * Device API key hashes are never readable by clients (column privileges).
-- =============================================================================

-- Enable RLS everywhere.
alter table public.app_settings    enable row level security;
alter table public.profiles        enable row level security;
alter table public.meters          enable row level security;
alter table public.readings        enable row level security;
alter table public.daily_metrics   enable row level security;
alter table public.external_weather enable row level security;
alter table public.tariffs         enable row level security;
alter table public.budgets         enable row level security;
alter table public.lpg_levels      enable row level security;
alter table public.devices         enable row level security;
alter table public.sensor_readings enable row level security;
alter table public.alerts          enable row level security;
alter table public.audit_log       enable row level security;
alter table public.import_log      enable row level security;

-- Remove blanket privileges, then grant only what is needed.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all tables in schema public from authenticated;
grant usage on schema public to authenticated;

grant select on public.app_settings, public.meters, public.readings, public.daily_metrics,
                public.external_weather, public.tariffs, public.budgets, public.lpg_levels,
                public.sensor_readings, public.alerts, public.profiles
  to authenticated;
grant insert, update, delete on public.app_settings, public.meters, public.tariffs, public.budgets,
                public.external_weather
  to authenticated;
grant insert, update on public.readings, public.daily_metrics to authenticated;
grant delete on public.readings, public.daily_metrics to authenticated;
grant insert on public.lpg_levels to authenticated;
grant delete on public.lpg_levels to authenticated;
grant update (role, can_enter_data, active, display_name) on public.profiles to authenticated;
grant update (acknowledged_at, acknowledged_by) on public.alerts to authenticated;
grant delete on public.alerts, public.sensor_readings to authenticated;
grant select on public.audit_log, public.import_log to authenticated;

-- Devices: clients may read everything except the key hash.
grant select (id, device_id, name, location, firmware_version, last_seen_at, last_reading_at,
              last_status, active, created_at) on public.devices to authenticated;
grant update (name, location, active) on public.devices to authenticated;
grant delete on public.devices to authenticated;

-- ---------------------------------------------------------------- policies --
-- (drop first so the migration can be re-run)
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (public.is_active_user() or id = auth.uid());
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- read-only reference data for every active user, writes for admins
create policy settings_select on public.app_settings for select to authenticated using (public.is_active_user());
create policy settings_write  on public.app_settings for all    to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy meters_select on public.meters for select to authenticated using (public.is_active_user());
create policy meters_write  on public.meters for all    to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy tariffs_select on public.tariffs for select to authenticated using (public.is_active_user());
create policy tariffs_write  on public.tariffs for all    to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy budgets_select on public.budgets for select to authenticated using (public.is_active_user());
create policy budgets_write  on public.budgets for all    to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy weather_select on public.external_weather for select to authenticated using (public.is_active_user());
create policy weather_write  on public.external_weather for all    to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- readings: view for all, enter/edit with permission, delete admin only
create policy readings_select on public.readings for select to authenticated using (public.is_active_user());
create policy readings_insert on public.readings for insert to authenticated with check (public.can_enter());
create policy readings_update on public.readings for update to authenticated
  using (public.can_enter()) with check (public.can_enter());
create policy readings_delete on public.readings for delete to authenticated using (public.is_admin());

create policy metrics_select on public.daily_metrics for select to authenticated using (public.is_active_user());
create policy metrics_insert on public.daily_metrics for insert to authenticated with check (public.can_enter());
create policy metrics_update on public.daily_metrics for update to authenticated
  using (public.can_enter()) with check (public.can_enter());
create policy metrics_delete on public.daily_metrics for delete to authenticated using (public.is_admin());

create policy lpg_select on public.lpg_levels for select to authenticated using (public.is_active_user());
create policy lpg_insert on public.lpg_levels for insert to authenticated with check (public.can_enter());
create policy lpg_delete on public.lpg_levels for delete to authenticated using (public.is_admin());

-- devices / sensors
create policy devices_select on public.devices for select to authenticated using (public.is_active_user());
create policy devices_update on public.devices for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy devices_delete on public.devices for delete to authenticated using (public.is_admin());

create policy sensor_select on public.sensor_readings for select to authenticated using (public.is_active_user());
create policy sensor_delete on public.sensor_readings for delete to authenticated using (public.is_admin());

-- alerts
create policy alerts_select on public.alerts for select to authenticated using (public.is_active_user());
create policy alerts_ack on public.alerts for update to authenticated
  using (public.is_active_user()) with check (public.is_active_user());
create policy alerts_delete on public.alerts for delete to authenticated using (public.is_admin());

-- logs: administrators only
create policy audit_select  on public.audit_log  for select to authenticated using (public.is_admin());
create policy imports_select on public.import_log for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------- realtime --
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.readings;        exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.daily_metrics;   exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.sensor_readings; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.alerts;          exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.lpg_levels;      exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.meters;          exception when duplicate_object then null; end;
  end if;
end $$;

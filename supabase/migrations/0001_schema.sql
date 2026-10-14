-- =============================================================================
-- Grand Hyatt The Red Sea – Energy & Utilities Management Dashboard
-- Migration 0001: core schema (tables, helper functions, triggers)
--
-- Runs on Supabase (PostgreSQL 15+). Idempotent where practical.
-- Timestamps are stored as timestamptz (UTC). Calendar dates (reading_date)
-- are plain `date` values in the property's local calendar (Asia/Riyadh).
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- Application settings (key/value, JSON). No secrets are stored here.
-- -----------------------------------------------------------------------------
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

create or replace function public.setting_text(p_key text, p_default text)
returns text language sql stable set search_path = public as $$
  select coalesce((select value #>> '{}' from public.app_settings where key = p_key), p_default)
$$;

-- "Today" in the property's local time zone (setting `timezone`, default Asia/Riyadh).
create or replace function public.local_today()
returns date language sql stable set search_path = public as $$
  select (now() at time zone public.setting_text('timezone', 'Asia/Riyadh'))::date
$$;

-- -----------------------------------------------------------------------------
-- Users / roles
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  username        text not null check (username ~ '^[A-Za-z0-9._-]{3,32}$'),
  display_name    text not null,
  role            text not null default 'user' check (role in ('admin', 'user')),
  can_enter_data  boolean not null default false,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
create unique index if not exists profiles_username_lower_uq on public.profiles (lower(username));

-- Role helpers. SECURITY DEFINER so that RLS policies can call them without
-- recursive policy evaluation on `profiles`.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'admin' and p.active)
$$;

create or replace function public.can_enter()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.active
                    and (p.role = 'admin' or p.can_enter_data))
$$;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active)
$$;

-- -----------------------------------------------------------------------------
-- Meters (one row per meter; mirrors the rows of the "Daily Consumption" sheet)
-- -----------------------------------------------------------------------------
create table if not exists public.meters (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  utility          text not null check (utility in ('energy', 'water', 'gas', 'chilled')),
  area             text not null,
  name             text not null,
  unit             text not null,
  sort_order       integer not null default 0,
  include_in_total boolean not null default true,
  rollover_at      numeric(18, 3) check (rollover_at is null or rollover_at > 0),
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (utility, name)
);

-- -----------------------------------------------------------------------------
-- Daily cumulative meter readings
--   consumption(day) = closing(day) - opening(day)
--   opening(day) defaults to closing(day - 1) of the same meter unless an
--   explicit opening is stored (first day of the year, meter replacement, ...).
-- -----------------------------------------------------------------------------
create table if not exists public.readings (
  id           uuid primary key default gen_random_uuid(),
  meter_id     uuid not null references public.meters (id) on delete cascade,
  reading_date date not null check (reading_date between date '2020-01-01' and date '2100-12-31'),
  opening      numeric(18, 3) check (opening is null or opening >= 0),
  closing      numeric(18, 3) check (closing is null or closing >= 0),
  note         text,
  source       text not null default 'manual' check (source in ('manual', 'import')),
  entered_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (meter_id, reading_date),
  check (opening is not null or closing is not null)
);
create index if not exists readings_date_idx on public.readings (reading_date);

-- Daily climate / occupancy inputs (rows 110-114 of "Daily Consumption").
create table if not exists public.daily_metrics (
  metric_date    date primary key,
  avg_temp_c     numeric(5, 2) check (avg_temp_c is null or avg_temp_c between -30 and 70),
  occupancy_rate numeric(5, 4) check (occupancy_rate is null or occupancy_rate between 0 and 1),
  occupied_rooms integer check (occupied_rooms is null or occupied_rooms >= 0),
  guests         integer check (guests is null or guests >= 0),
  temp_source    text not null default 'manual' check (temp_source in ('manual')),
  updated_by     uuid references auth.users (id) on delete set null,
  updated_at     timestamptz not null default now()
);

-- Daily temperature from an external weather service (kept apart from manual data).
create table if not exists public.external_weather (
  weather_date date primary key,
  avg_temp_c   numeric(5, 2),
  min_temp_c   numeric(5, 2),
  max_temp_c   numeric(5, 2),
  provider     text not null default 'open-meteo',
  fetched_at   timestamptz not null default now(),
  fetched_by   uuid references auth.users (id) on delete set null
);

-- -----------------------------------------------------------------------------
-- Tariffs (SAR per unit) – the workbook has no prices, so costs stay N/A
-- until an administrator configures them.
-- -----------------------------------------------------------------------------
create table if not exists public.tariffs (
  id             uuid primary key default gen_random_uuid(),
  utility        text not null check (utility in ('energy', 'water', 'gas', 'chilled')),
  price_per_unit numeric(14, 6) not null check (price_per_unit >= 0),
  currency       text not null default 'SAR',
  effective_from date not null,
  note           text,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (utility, effective_from)
);

-- -----------------------------------------------------------------------------
-- Utility budget (inputs of "Utility Budget & Actual").
--   fiscal_year = calendar year in which the fiscal year starts (2026 = FY2026-27)
--   month       = calendar month 1..12
--   kind        = 'budget' or 'previous' (PREVIOUS PERIOD REFERENCE block)
-- -----------------------------------------------------------------------------
create table if not exists public.budgets (
  fiscal_year    integer not null,
  month          integer not null check (month between 1 and 12),
  kind           text not null check (kind in ('budget', 'previous')),
  rooms_sold     numeric(14, 2) check (rooms_sold is null or rooms_sold >= 0),
  occupancy_rate numeric(6, 4) check (occupancy_rate is null or occupancy_rate between 0 and 1),
  guests         numeric(14, 2) check (guests is null or guests >= 0),
  gas            numeric(18, 3) check (gas is null or gas >= 0),
  electricity    numeric(18, 3) check (electricity is null or electricity >= 0),
  water          numeric(18, 3) check (water is null or water >= 0),
  updated_by     uuid references auth.users (id) on delete set null,
  updated_at     timestamptz not null default now(),
  primary key (fiscal_year, month, kind)
);

-- -----------------------------------------------------------------------------
-- LPG tank levels (sheet "LPG Dashboard"). Level is stored as a fraction 0..1
-- exactly like the workbook cells B12/F12/J12.
-- -----------------------------------------------------------------------------
create table if not exists public.lpg_levels (
  id             uuid primary key default gen_random_uuid(),
  tank           smallint not null check (tank between 1 and 3),
  level_fraction numeric(5, 4) not null check (level_fraction between 0 and 1),
  recorded_at    timestamptz not null default now(),
  recorded_by    uuid references auth.users (id) on delete set null
);
create index if not exists lpg_levels_tank_time_idx on public.lpg_levels (tank, recorded_at desc);

-- -----------------------------------------------------------------------------
-- IoT devices + sensor readings
-- -----------------------------------------------------------------------------
create table if not exists public.devices (
  id               uuid primary key default gen_random_uuid(),
  device_id        text not null unique check (device_id ~ '^[A-Za-z0-9_-]{3,40}$'),
  name             text not null,
  location         text,
  api_key_hash     text not null,
  firmware_version text,
  last_seen_at     timestamptz,
  last_reading_at  timestamptz,
  last_status      jsonb,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

create table if not exists public.sensor_readings (
  id                  bigint generated always as identity primary key,
  device_ref          uuid not null references public.devices (id) on delete cascade,
  measured_at         timestamptz not null,
  received_at         timestamptz not null default now(),
  aht20_temp_c        numeric(5, 2) check (aht20_temp_c is null or aht20_temp_c between -40 and 85),
  aht20_humidity_pct  numeric(5, 2) check (aht20_humidity_pct is null or aht20_humidity_pct between 0 and 100),
  bmp280_temp_c       numeric(5, 2) check (bmp280_temp_c is null or bmp280_temp_c between -40 and 85),
  bmp280_pressure_hpa numeric(7, 2) check (bmp280_pressure_hpa is null or bmp280_pressure_hpa between 300 and 1100),
  aht20_ok            boolean not null default true,
  bmp280_ok           boolean not null default true,
  boot_count          integer,
  unique (device_ref, measured_at)
);
create index if not exists sensor_readings_time_idx on public.sensor_readings (measured_at desc);

-- -----------------------------------------------------------------------------
-- Alerts (sensor thresholds, device offline, ...). Deduplicated by dedupe_key.
-- -----------------------------------------------------------------------------
create table if not exists public.alerts (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  kind            text not null check (kind in
                    ('temperature', 'humidity', 'pressure', 'device_offline', 'sensor_fault',
                     'abnormal_consumption', 'data_missing', 'other')),
  severity        text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  title           text not null,
  message         text,
  metric          text,
  value           numeric,
  threshold       numeric,
  device_ref      uuid references public.devices (id) on delete cascade,
  dedupe_key      text not null,
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users (id) on delete set null,
  resolved_at     timestamptz
);
-- At most one *open* alert per dedupe key.
create unique index if not exists alerts_open_dedupe_uq on public.alerts (dedupe_key) where resolved_at is null;
create index if not exists alerts_created_idx on public.alerts (created_at desc);

-- -----------------------------------------------------------------------------
-- Audit + import logs
-- -----------------------------------------------------------------------------
create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  user_id    uuid,
  username   text,
  action     text not null,
  table_name text not null,
  record_id  text,
  old_data   jsonb,
  new_data   jsonb
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);

create table if not exists public.import_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  user_id     uuid,
  username    text,
  filename    text,
  mode        text,
  summary     jsonb
);

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Validates and normalises a reading row before it is stored.
create or replace function public.before_reading_write()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' and new.entered_by is null then
    new.entered_by := auth.uid();
  end if;
  if new.reading_date > public.local_today() then
    raise exception 'Reading date % is in the future', new.reading_date using errcode = 'check_violation';
  end if;
  if new.opening is not null and new.closing is not null and new.closing < new.opening
     and not exists (select 1 from public.meters m
                      where m.id = new.meter_id and m.rollover_at is not null) then
    -- A decreasing meter is only accepted for meters configured with a rollover value.
    -- (Meter replacements: enter the new meter's opening reading explicitly instead.)
    if coalesce(current_setting('app.allow_negative', true), 'off') <> 'on' then
      raise exception 'Closing reading (%) is lower than opening reading (%)', new.closing, new.opening
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists readings_before_write on public.readings;
create trigger readings_before_write before insert or update on public.readings
  for each row execute function public.before_reading_write();

drop trigger if exists daily_metrics_touch on public.daily_metrics;
create trigger daily_metrics_touch before update on public.daily_metrics
  for each row execute function public.touch_updated_at();

drop trigger if exists budgets_touch on public.budgets;
create trigger budgets_touch before update on public.budgets
  for each row execute function public.touch_updated_at();

-- Generic audit trigger. Bulk imports set `app.skip_audit = on` for their transaction.
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid := auth.uid();
  v_name  text;
  v_id    text;
  v_old   jsonb;
  v_new   jsonb;
begin
  if coalesce(current_setting('app.skip_audit', true), 'off') = 'on' then
    return coalesce(new, old);
  end if;
  select username into v_name from public.profiles where id = v_user;
  if tg_op = 'DELETE' then
    v_old := to_jsonb(old);
    v_id := coalesce(v_old ->> 'id', v_old ->> 'key', v_old ->> 'metric_date', v_old ->> 'fiscal_year');
  elsif tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_id := coalesce(v_new ->> 'id', v_new ->> 'key', v_new ->> 'metric_date', v_new ->> 'fiscal_year');
  else
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_id := coalesce(v_new ->> 'id', v_new ->> 'key', v_new ->> 'metric_date', v_new ->> 'fiscal_year');
    if v_old = v_new then
      return new;
    end if;
  end if;
  insert into public.audit_log (user_id, username, action, table_name, record_id, old_data, new_data)
  values (v_user, v_name, tg_op, tg_table_name, v_id, v_old, v_new);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['readings', 'daily_metrics', 'meters', 'tariffs', 'budgets',
                           'lpg_levels', 'app_settings', 'profiles']
  loop
    execute format('drop trigger if exists audit_%1$s on public.%1$s', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s
                    for each row execute function public.audit_row()', t);
  end loop;
end $$;

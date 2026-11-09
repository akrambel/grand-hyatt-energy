-- =============================================================================
-- Migration 0012: activity page for the owner account only
--
--  1. is_owner()        - true for the owner account (profiles.is_owner, set in 0008: "akram").
--  2. user_presence     - one row per user: last time the website was open, which page, which device.
--                         Written only through heartbeat(); read only through owner_people().
--  3. sign_in_log       - every sign-in (who, when, device). Read by the owner only.
--  4. audit_log         - the change history (who added, changed or deleted what) is now visible to
--                         the owner only (it was visible to every administrator). Guest-room readings,
--                         rooms and saved monthly reports are now recorded too.
-- Safe to run more than once.
-- =============================================================================

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_owner and active);
$$;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

-- ------------------------------------------------------------ presence ----
create table if not exists public.user_presence (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  page         text,
  device       text
);
alter table public.user_presence enable row level security;
revoke all on public.user_presence from public, anon, authenticated;

create or replace function public.heartbeat(p_page text default null, p_device text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.user_presence (user_id, last_seen_at, page, device)
  values (auth.uid(), now(), left(p_page, 80), left(p_device, 120))
  on conflict (user_id) do update
    set last_seen_at = now(), page = left(p_page, 80), device = coalesce(left(p_device, 120), public.user_presence.device);
end $$;
revoke all on function public.heartbeat(text, text) from public, anon;
grant execute on function public.heartbeat(text, text) to authenticated;

-- ------------------------------------------------------------ sign-ins ----
create table if not exists public.sign_in_log (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  user_id  uuid references auth.users (id) on delete set null,
  username text,
  device   text
);
create index if not exists sign_in_log_at_idx on public.sign_in_log (at desc);
alter table public.sign_in_log enable row level security;
revoke all on public.sign_in_log from public, anon, authenticated;
grant select on public.sign_in_log to authenticated;
drop policy if exists sign_in_log_select on public.sign_in_log;
create policy sign_in_log_select on public.sign_in_log for select to authenticated using (public.is_owner());

create or replace function public.log_sign_in(p_device text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.sign_in_log (user_id, username, device)
  select p.id, p.username, left(p_device, 120) from public.profiles p where p.id = auth.uid();
  perform public.heartbeat('Sign-in', p_device);
end $$;
revoke all on function public.log_sign_in(text) from public, anon;
grant execute on function public.log_sign_in(text) to authenticated;

-- Everybody with an account: online status, page, device, last sign-in. Owner only.
create or replace function public.owner_people()
returns table (user_id uuid, username text, display_name text, role text, active boolean,
               last_seen_at timestamptz, page text, device text, last_sign_in_at timestamptz, sign_ins_30d bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner account can see the activity page' using errcode = 'insufficient_privilege';
  end if;
  return query
    select p.id, p.username, p.display_name, p.role::text, p.active, pr.last_seen_at, pr.page, pr.device,
           (select max(s.at) from public.sign_in_log s where s.user_id = p.id),
           (select count(*) from public.sign_in_log s where s.user_id = p.id and s.at > now() - interval '30 days')
      from public.profiles p
      left join public.user_presence pr on pr.user_id = p.id
     order by pr.last_seen_at desc nulls last, p.display_name;
end $$;
revoke all on function public.owner_people() from public, anon;
grant execute on function public.owner_people() to authenticated;

-- ------------------------------------------------------ change history ----
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated using (public.is_owner());

do $$
declare t text;
begin
  foreach t in array array['rooms', 'room_readings', 'monthly_reports']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists audit_%1$s on public.%1$s', t);
      execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s
                      for each row execute function public.audit_row()', t);
    end if;
  end loop;
end $$;

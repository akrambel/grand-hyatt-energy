-- =============================================================================
-- Migration 0008: deleting users
--
--  1. profiles.is_owner   - the owner account (username "akram") can never be deleted, deactivated or
--                           demoted, by anyone. Only this migration (or the SQL editor) can change it.
--  2. admin_delete_user() - an administrator deletes another user (sign-in account and profile).
--                           Their readings stay; "Entered by" for those readings becomes empty.
--                           Not allowed: yourself, the owner, the last active administrator.
-- Safe to run more than once.
-- =============================================================================

-- ------------------------------------------------------------- 1. owner ----
alter table public.profiles add column if not exists is_owner boolean not null default false;
update public.profiles set is_owner = true where lower(username) = 'akram' and not is_owner;

do $$ begin
  if not exists (select 1 from public.profiles where is_owner) then
    raise notice 'No account named "akram" was found: no account is protected yet. Run: update public.profiles set is_owner = true where username = ''<your username>'';';
  end if;
end $$;

-- The owner keeps the administrator role and stays active (extends the "last administrator" check of 0007).
create or replace function public.keep_one_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.is_owner and (new.role <> 'admin' or not new.active) then
    raise exception 'The owner account cannot be demoted or deactivated' using errcode = 'check_violation';
  end if;
  if old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active)
     and not exists (select 1 from public.profiles p where p.id <> old.id and p.role = 'admin' and p.active) then
    raise exception 'At least one active administrator is required' using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- ------------------------------------------------------ 2. delete a user ----
create or replace function public.admin_delete_user(p_id uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
declare
  t public.profiles;
  me text;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = 'insufficient_privilege';
  end if;
  if p_id = auth.uid() then
    raise exception 'You cannot delete your own account' using errcode = 'check_violation';
  end if;
  select * into t from public.profiles where id = p_id;
  if not found then
    raise exception 'Unknown user' using errcode = 'no_data_found';
  end if;
  if t.is_owner then
    raise exception 'The owner account cannot be deleted' using errcode = 'check_violation';
  end if;
  if t.role = 'admin' and t.active
     and not exists (select 1 from public.profiles p where p.id <> t.id and p.role = 'admin' and p.active) then
    raise exception 'At least one active administrator is required' using errcode = 'check_violation';
  end if;

  select username into me from public.profiles where id = auth.uid();
  insert into public.audit_log (user_id, username, action, table_name, record_id, old_data)
  values (auth.uid(), me, 'DELETE_USER', 'profiles', t.id::text,
          jsonb_build_object('username', t.username, 'display_name', t.display_name, 'role', t.role));

  -- Deleting the sign-in account removes the profile too (on delete cascade);
  -- readings keep their values and their "entered_by" becomes empty (on delete set null).
  delete from auth.users where id = p_id;
end $$;
revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;

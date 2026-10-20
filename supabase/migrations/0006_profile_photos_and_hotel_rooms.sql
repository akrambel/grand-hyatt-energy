-- =============================================================================
-- Migration 0006: profile photos and the hotel's guest-room list
--
--  1. profiles.avatar_path - path of the user's photo in the private "avatars" storage bucket
--                            (<user id>/<file>.jpg). Users set their own through set_my_avatar();
--                            they still cannot change any other column of their profile.
--  2. storage bucket "avatars" - private, 1 MB per file, JPG / PNG / WebP. Every signed-in active user
--                            can see the photos; each user can only write in their own folder.
--  3. rooms                - the 368 guest rooms of Grand Hyatt The Red Sea:
--                            L00 001-095 (no 053-057) · L01 101-195 · L02 201-275 · L03 301-362 ·
--                            L04 401-436 · beach villas 901-910. Existing rooms are left as they are.
-- Safe to run more than once.
-- =============================================================================

-- ------------------------------------------------------------ 1. profiles ----
alter table public.profiles add column if not exists avatar_path text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_avatar_path_check') then
    alter table public.profiles add constraint profiles_avatar_path_check
      check (avatar_path is null or avatar_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$');
  end if;
end $$;

-- Administrators may clear someone's photo through the existing admin-only update policy.
grant update (avatar_path) on public.profiles to authenticated;

create or replace function public.set_my_avatar(p_path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_path is not null and split_part(p_path, '/', 1) <> auth.uid()::text then
    raise exception 'A photo can only be stored in your own folder' using errcode = '42501';
  end if;
  update public.profiles set avatar_path = p_path where id = auth.uid();
end $$;
revoke all on function public.set_my_avatar(text) from public, anon;
grant execute on function public.set_my_avatar(text) to authenticated;

-- ------------------------------------------------------------- 2. storage ----
-- Skipped on a plain PostgreSQL (the test database has no "storage" schema).
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('avatars', 'avatars', false, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
                                   allowed_mime_types = excluded.allowed_mime_types;

    execute 'drop policy if exists avatars_read on storage.objects';
    execute 'drop policy if exists avatars_insert on storage.objects';
    execute 'drop policy if exists avatars_update on storage.objects';
    execute 'drop policy if exists avatars_delete on storage.objects';
    execute $p$create policy avatars_read on storage.objects for select to authenticated
      using (bucket_id = 'avatars' and public.is_active_user())$p$;
    execute $p$create policy avatars_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'avatars' and public.is_active_user()
                  and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute $p$create policy avatars_update on storage.objects for update to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
      with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute $p$create policy avatars_delete on storage.objects for delete to authenticated
      using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()))$p$;
  end if;
end $$;

-- --------------------------------------------------------------- 3. rooms ----
insert into public.rooms (room_number, sort_order)
select lpad(n::text, 3, '0'), n
from (
  select generate_series(1, 95)    as n union all
  select generate_series(101, 195)        union all
  select generate_series(201, 275)        union all
  select generate_series(301, 362)        union all
  select generate_series(401, 436)        union all
  select generate_series(901, 910)
) s
where n not between 53 and 57
on conflict (room_number) do nothing;

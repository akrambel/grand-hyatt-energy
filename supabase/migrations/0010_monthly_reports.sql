-- =============================================================================
-- Migration 0010: monthly PDF reports kept in the website
--
--  1. monthly_reports      - one row per month: where its PDF is stored and when it was made.
--                            Everybody who may view reports can list them; administrators add them.
--  2. storage bucket "reports" - private, PDF only, 10 MB per file. Read: users allowed to view
--                            reports (not recorders). Write: administrators.
-- The PDF of the previous month is created automatically the first time an administrator opens the
-- website in a new month, and offered to everybody in the notifications and on Monthly Reports.
-- Safe to run more than once.
-- =============================================================================

-- ------------------------------------------------------- 1. report list ----
create table if not exists public.monthly_reports (
  month_key   text primary key check (month_key ~ '^\d{4}-\d{2}$'),   -- e.g. 2026-10
  label       text not null,                                           -- e.g. Oct 2026
  path        text not null,                                           -- file name in the "reports" bucket
  size_bytes  integer,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null
);

alter table public.monthly_reports enable row level security;
revoke all on public.monthly_reports from public, anon;
grant select, insert, update, delete on public.monthly_reports to authenticated;

drop policy if exists monthly_reports_select on public.monthly_reports;
create policy monthly_reports_select on public.monthly_reports for select to authenticated using (public.can_view());
drop policy if exists monthly_reports_insert on public.monthly_reports;
create policy monthly_reports_insert on public.monthly_reports for insert to authenticated with check (public.is_admin());
drop policy if exists monthly_reports_update on public.monthly_reports;
create policy monthly_reports_update on public.monthly_reports for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists monthly_reports_delete on public.monthly_reports;
create policy monthly_reports_delete on public.monthly_reports for delete to authenticated using (public.is_admin());

-- ------------------------------------------------------------ 2. storage ----
-- Skipped on a plain PostgreSQL (the test database has no "storage" schema).
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('reports', 'reports', false, 10485760, array['application/pdf'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
                                   allowed_mime_types = excluded.allowed_mime_types;

    execute 'drop policy if exists reports_read on storage.objects';
    execute 'drop policy if exists reports_insert on storage.objects';
    execute 'drop policy if exists reports_update on storage.objects';
    execute 'drop policy if exists reports_delete on storage.objects';
    execute $p$create policy reports_read on storage.objects for select to authenticated
      using (bucket_id = 'reports' and public.can_view())$p$;
    execute $p$create policy reports_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'reports' and public.is_admin())$p$;
    execute $p$create policy reports_update on storage.objects for update to authenticated
      using (bucket_id = 'reports' and public.is_admin()) with check (bucket_id = 'reports' and public.is_admin())$p$;
    execute $p$create policy reports_delete on storage.objects for delete to authenticated
      using (bucket_id = 'reports' and public.is_admin())$p$;
  end if;
end $$;

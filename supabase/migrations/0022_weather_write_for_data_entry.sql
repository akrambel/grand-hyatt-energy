-- 0022: outside weather is downloaded automatically by the website (Open-Meteo, from 3 Oct 2026).
-- Besides administrators, users who enter data (recorders, users with data entry) may store it, so the
-- daily outside temperature stays up to date whoever opens the website. Safe to run more than once.
drop policy if exists weather_write on public.external_weather;
create policy weather_write on public.external_weather for all to authenticated
  using (public.is_admin() or public.can_enter()) with check (public.is_admin() or public.can_enter());

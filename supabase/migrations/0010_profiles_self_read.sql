-- Permitir que cada usuario autenticado lea su propio perfil.
-- La política anterior dependía de is_staff(), que a su vez consulta profiles.
-- Esta política evita bloquear la lectura inicial del rol por RLS.
drop policy if exists "users read own profile" on public.profiles;
create policy "users read own profile"
on public.profiles
for select
to authenticated
using (id = auth.uid());

grant select on public.profiles to authenticated;

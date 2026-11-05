-- Endurecer las políticas de acceso por rol.
drop policy if exists "staff manage clients" on public.clients;
drop policy if exists "staff manage machines" on public.machines;
create policy "staff read clients" on public.clients for select to authenticated using (public.is_staff());
create policy "staff read machines" on public.machines for select to authenticated using (public.is_staff());
create policy "admin supervisor manage clients" on public.clients
for all to authenticated
using (public.current_role() in ('admin','supervisor'))
with check (public.current_role() in ('admin','supervisor'));
create policy "admin supervisor manage machines" on public.machines
for all to authenticated
using (public.current_role() in ('admin','supervisor'))
with check (public.current_role() in ('admin','supervisor'));

drop policy if exists "staff request parts" on public.parts_requests;
create policy "staff request pending parts" on public.parts_requests
for insert to authenticated
with check (
  public.current_role() in ('admin','supervisor','tecnico')
  and status = 'pendiente'
  and authorized_at is null
  and authorized_by is null
);

-- No se permite que un usuario técnico cree solicitudes ya autorizadas o rechazadas.
create or replace function public.guard_new_part_request() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.status <> 'pendiente' or new.authorized_at is not null or new.authorized_by is not null then
    raise exception 'Los repuestos nuevos deben quedar pendientes de autorización';
  end if;
  new.created_by := auth.uid();
  if public.current_role() = 'tecnico' then
    new.warranty_covered := false;
    new.client_contacted := false;
  end if;
  return new;
end;
$$;
drop trigger if exists parts_insert_guard on public.parts_requests;
create trigger parts_insert_guard before insert on public.parts_requests
for each row execute function public.guard_new_part_request();

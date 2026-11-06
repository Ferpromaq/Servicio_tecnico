-- Aislar la ficha de clientes y los documentos del ingreso por rol.
-- Administración y supervisión conservan acceso completo. Un técnico solo puede
-- leer la ficha del cliente y los documentos de las órdenes que tiene asignadas.

drop policy if exists "staff read clients" on public.clients;

create policy "admin supervisor read all clients"
on public.clients
for select
to authenticated
using (public.current_role() in ('admin','supervisor'));

create policy "technician read clients on assigned orders"
on public.clients
for select
to authenticated
using (
  public.current_role() = 'tecnico'
  and exists (
    select 1
    from public.service_orders so
    where so.client_id = clients.id
      and so.assigned_technician = auth.uid()
  )
);

drop policy if exists "staff manage order documents" on storage.objects;

create policy "admin supervisor manage order documents"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'order-documents'
  and public.current_role() in ('admin','supervisor')
)
with check (
  bucket_id = 'order-documents'
  and public.current_role() in ('admin','supervisor')
);

create policy "technicians read assigned order documents"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'order-documents'
  and public.current_role() = 'tecnico'
  and exists (
    select 1
    from public.service_orders so
    where so.id::text = split_part(storage.objects.name, '/', 1)
      and so.assigned_technician = auth.uid()
  )
);

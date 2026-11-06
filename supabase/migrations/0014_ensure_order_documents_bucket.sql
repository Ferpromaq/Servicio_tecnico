-- Garantiza que el almacenamiento privado de documentos de órdenes exista
-- en el proyecto Supabase antes de que la aplicación intente subir fotografías.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'order-documents',
  'order-documents',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Mantiene el bucket privado y aplica el mismo acceso por rol que la migración 0013.
drop policy if exists "admin supervisor manage order documents" on storage.objects;
create policy "admin supervisor manage order documents"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'order-documents'
  and public.current_role() in ('admin', 'supervisor')
)
with check (
  bucket_id = 'order-documents'
  and public.current_role() in ('admin', 'supervisor')
);

drop policy if exists "technicians read assigned order documents" on storage.objects;
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

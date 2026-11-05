-- Clasificación del ingreso y documentos obligatorios por modalidad.
alter table public.service_orders
  add column if not exists intake_type text not null default 'no_warranty'
    check (intake_type in ('warranty','no_warranty','commissioning')),
  add column if not exists warranty_photo_path text,
  add column if not exists purchase_invoice_photo_path text,
  add column if not exists diagnosis_receipt_type text,
  add column if not exists diagnosis_receipt_number text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('order-documents', 'order-documents', false, 8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false, file_size_limit=8388608, allowed_mime_types=array['image/jpeg','image/png','image/webp'];

drop policy if exists "staff manage order documents" on storage.objects;
create policy "staff manage order documents" on storage.objects
for all to authenticated
using (bucket_id = 'order-documents' and public.is_staff())
with check (bucket_id = 'order-documents' and public.is_staff());

-- Una puesta en marcha nunca genera cobros por diagnóstico ni instalación.
create or replace function public.update_order_costs(
  p_order_id uuid,
  p_diagnosis_amount numeric,
  p_installation_amount numeric
) returns void
language plpgsql security definer set search_path=public as $$
declare v_role public.app_role; v_commissioning boolean;
begin
  select role into v_role from public.profiles where id=auth.uid() and active=true;
  if v_role not in ('admin','supervisor') then raise exception 'No tienes permiso para modificar los valores de la orden'; end if;
  if p_diagnosis_amount is null or p_installation_amount is null or p_diagnosis_amount < 0 or p_installation_amount < 0 then raise exception 'Los montos no pueden ser negativos'; end if;
  select commissioning into v_commissioning from public.service_orders where id=p_order_id;
  if not found then raise exception 'La orden no existe'; end if;
  update public.service_orders
     set diagnosis_amount=case when v_commissioning then 0 else p_diagnosis_amount end,
         installation_amount=case when v_commissioning then 0 else p_installation_amount end,
         updated_at=now()
   where id=p_order_id;
  insert into public.order_events(order_id,event_type,description,actor_id,metadata)
  values(p_order_id,'costos',case when v_commissioning then 'Puesta en marcha: costos de servicio en $0' else 'Valores de diagnóstico e instalación actualizados' end,auth.uid(),
    jsonb_build_object('diagnosis_amount',case when v_commissioning then 0 else p_diagnosis_amount end,'installation_amount',case when v_commissioning then 0 else p_installation_amount end));
end;
$$;

-- La puesta en marcha solo requiere el número de factura y nunca genera cobros.
create or replace function public.update_order_warranty(p_order_id uuid,p_warranty_entry boolean,p_warranty_covers_damage boolean,p_receipt_type text,p_receipt_number text,p_receipt_date date,p_commissioning boolean default false) returns void language plpgsql security definer set search_path=public as $$
declare v_role public.app_role;
begin
 select role into v_role from public.profiles where id=auth.uid() and active=true;
 if v_role not in ('admin','supervisor') then raise exception 'No tienes permiso para modificar la garantía'; end if;
 if p_commissioning and nullif(trim(coalesce(p_receipt_number,'')),'') is null then raise exception 'Puesta en Marcha requiere el número de factura de compra'; end if;
 update public.service_orders set commissioning=coalesce(p_commissioning,false),intake_type=case when p_commissioning then 'commissioning' when coalesce(p_warranty_entry,false) then 'warranty' else 'no_warranty' end,warranty_entry=case when p_commissioning then true else coalesce(p_warranty_entry,false) end,warranty_covers_damage=coalesce(p_warranty_covers_damage,false),receipt_type=nullif(trim(coalesce(p_receipt_type,'')),''),receipt_number=nullif(trim(coalesce(p_receipt_number,'')),''),receipt_date=p_receipt_date,diagnosis_amount=case when p_commissioning then 0 else diagnosis_amount end,installation_amount=case when p_commissioning then 0 else installation_amount end,updated_at=now() where id=p_order_id;
 if not found then raise exception 'La orden no existe'; end if;
 insert into public.order_events(order_id,event_type,description,actor_id) values(p_order_id,'garantia',case when p_commissioning then 'Orden marcada como Puesta en Marcha' else 'Datos de garantía actualizados' end,auth.uid());
end; $$;

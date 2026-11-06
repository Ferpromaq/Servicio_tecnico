-- Historial inmutable de informes de diagnóstico y solicitud múltiple de repuestos.
create table if not exists public.order_diagnosis_reports (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.service_orders(id) on delete cascade,
  report text not null check (length(trim(report)) > 0),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- Conserva como primer registro el último diagnóstico que ya estuviera guardado.
insert into public.order_diagnosis_reports(order_id, report, created_by, created_at)
select id, diagnosis, created_by, coalesce(updated_at, created_at)
from public.service_orders
where nullif(trim(diagnosis), '') is not null
  and not exists (
    select 1 from public.order_diagnosis_reports r
    where r.order_id = service_orders.id
  );

alter table public.order_diagnosis_reports enable row level security;
drop policy if exists "staff read diagnosis reports" on public.order_diagnosis_reports;
create policy "staff read diagnosis reports"
on public.order_diagnosis_reports for select to authenticated
using (public.is_staff());

create or replace function public.save_order_diagnosis(
  p_order_id uuid,
  p_diagnosis text,
  p_repair_notes text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare v_role public.app_role;
begin
  select role into v_role from public.profiles where id = auth.uid() and active = true;
  if v_role is null then raise exception 'No tienes acceso a esta operación'; end if;
  if length(trim(coalesce(p_diagnosis, ''))) = 0 then raise exception 'El informe de diagnóstico no puede estar vacío'; end if;

  insert into public.order_diagnosis_reports(order_id, report, created_by)
  values (p_order_id, trim(p_diagnosis), auth.uid());

  update public.service_orders
     set diagnosis = trim(p_diagnosis),
         repair_notes = coalesce(p_repair_notes, repair_notes),
         updated_at = now()
   where id = p_order_id;
  if not found then raise exception 'La orden no existe'; end if;

  insert into public.order_events(order_id,event_type,description,actor_id,metadata)
  values(p_order_id,'diagnostico','Nuevo informe de diagnóstico registrado',auth.uid(),
    jsonb_build_object('report', trim(p_diagnosis)));
end;
$$;

create or replace function public.request_order_parts(
  p_order_id uuid,
  p_parts jsonb
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_role public.app_role;
  v_item jsonb;
  v_description text;
  v_quantity numeric;
  v_unit_price numeric;
  v_from_stock boolean;
  v_part_id uuid;
begin
  select role into v_role from public.profiles where id = auth.uid() and active = true;
  if v_role not in ('admin','supervisor','tecnico') then
    raise exception 'No tienes permiso para solicitar repuestos';
  end if;
  if not exists (select 1 from public.service_orders where id = p_order_id) then
    raise exception 'La orden no existe';
  end if;
  if jsonb_typeof(p_parts) <> 'array' or jsonb_array_length(p_parts) = 0 then
    raise exception 'Agrega al menos un repuesto';
  end if;

  for v_item in select value from jsonb_array_elements(p_parts)
  loop
    v_description := trim(coalesce(v_item->>'description',''));
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_from_stock := coalesce((v_item->>'from_stock')::boolean, false);
    if v_description = '' or v_quantity <= 0 or v_unit_price < 0 then
      raise exception 'Revisa nombre, cantidad y valor de cada repuesto';
    end if;
    insert into public.parts_requests(order_id,description,quantity,unit_price,from_stock,created_by)
    values(p_order_id,v_description,v_quantity,v_unit_price,v_from_stock,auth.uid())
    returning id into v_part_id;

    insert into public.order_events(order_id,event_type,description,actor_id,metadata)
    values(p_order_id,'repuesto','Repuesto solicitado: '||v_description,auth.uid(),
      jsonb_build_object('part_id',v_part_id,'quantity',v_quantity,'unit_price',v_unit_price));
  end loop;
end;
$$;

revoke all on function public.save_order_diagnosis(uuid,text,text) from public;
grant execute on function public.save_order_diagnosis(uuid,text,text) to authenticated;
revoke all on function public.request_order_parts(uuid,jsonb) from public;
grant execute on function public.request_order_parts(uuid,jsonb) to authenticated;

notify pgrst, 'reload schema';

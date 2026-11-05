alter table public.service_orders
  add column if not exists commissioning boolean not null default false;

create or replace function public.update_order_warranty(
  p_order_id uuid,
  p_warranty_entry boolean,
  p_warranty_covers_damage boolean,
  p_receipt_type text,
  p_receipt_number text,
  p_receipt_date date,
  p_commissioning boolean default false
) returns void
language plpgsql security definer set search_path=public as $$
declare v_role public.app_role;
begin
  select role into v_role from public.profiles where id=auth.uid() and active=true;
  if v_role not in ('admin','supervisor') then raise exception 'No tienes permiso para modificar la garantía'; end if;
  if p_commissioning and (
    nullif(trim(coalesce(p_receipt_type,'')),'') is null
    or nullif(trim(coalesce(p_receipt_number,'')),'') is null
    or p_receipt_date is null
  ) then raise exception 'Puesta en Marcha requiere tipo, número y fecha de boleta o factura'; end if;
  update public.service_orders
     set commissioning=coalesce(p_commissioning,false),
         warranty_entry=case when p_commissioning then true else coalesce(p_warranty_entry,false) end,
         warranty_covers_damage=coalesce(p_warranty_covers_damage,false),
         receipt_type=nullif(trim(coalesce(p_receipt_type,'')),''),
         receipt_number=nullif(trim(coalesce(p_receipt_number,'')),''),
         receipt_date=p_receipt_date,
         updated_at=now()
   where id=p_order_id;
  if not found then raise exception 'La orden no existe'; end if;
  insert into public.order_events(order_id,event_type,description,actor_id)
  values(p_order_id,'garantia',case when p_commissioning then 'Orden marcada como Puesta en Marcha' else 'Datos de garantía actualizados' end,auth.uid());
end;
$$;

create or replace function public.update_order_costs(
  p_order_id uuid,
  p_diagnosis_amount numeric,
  p_installation_amount numeric
) returns void
language plpgsql security definer set search_path=public as $$
declare v_role public.app_role;
begin
  select role into v_role from public.profiles where id=auth.uid() and active=true;
  if v_role not in ('admin','supervisor') then raise exception 'No tienes permiso para modificar los valores de la orden'; end if;
  if p_diagnosis_amount is null or p_installation_amount is null or p_diagnosis_amount < 0 or p_installation_amount < 0 then raise exception 'Los montos no pueden ser negativos'; end if;
  update public.service_orders
     set diagnosis_amount=p_diagnosis_amount,installation_amount=p_installation_amount,updated_at=now()
   where id=p_order_id;
  if not found then raise exception 'La orden no existe'; end if;
  insert into public.order_events(order_id,event_type,description,actor_id,metadata)
  values(p_order_id,'costos','Valores de diagnóstico e instalación actualizados',auth.uid(),
    jsonb_build_object('diagnosis_amount',p_diagnosis_amount,'installation_amount',p_installation_amount));
end;
$$;

revoke all on function public.update_order_warranty(uuid,boolean,boolean,text,text,date,boolean) from public;
revoke all on function public.update_order_costs(uuid,numeric,numeric) from public;
grant execute on function public.update_order_warranty(uuid,boolean,boolean,text,text,date,boolean) to authenticated;
grant execute on function public.update_order_costs(uuid,numeric,numeric) to authenticated;

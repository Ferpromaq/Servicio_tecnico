-- Funciones transaccionales para respetar los permisos de cada rol.
-- Ejecutar después de 0001_initial_schema.sql.

create or replace function public.save_order_diagnosis(
  p_order_id uuid,
  p_diagnosis text,
  p_repair_notes text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_role public.app_role;
begin
  select role into v_role from public.profiles where id = auth.uid() and active = true;
  if v_role is null then raise exception 'No tienes acceso a esta operación'; end if;
  update public.service_orders
     set diagnosis = nullif(trim(p_diagnosis), ''),
         repair_notes = coalesce(p_repair_notes, repair_notes),
         updated_at = now()
   where id = p_order_id;
  if not found then raise exception 'La orden no existe'; end if;
  insert into public.order_events(order_id,event_type,description,actor_id)
  values(p_order_id,'diagnostico','Diagnóstico actualizado',auth.uid());
end;
$$;

create or replace function public.request_order_part(
  p_order_id uuid,
  p_description text,
  p_quantity numeric,
  p_unit_price numeric default 0,
  p_from_stock boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_role public.app_role; v_id uuid;
begin
  select role into v_role from public.profiles where id = auth.uid() and active = true;
  if v_role not in ('admin','supervisor','tecnico') then raise exception 'No tienes permiso para solicitar repuestos'; end if;
  if trim(coalesce(p_description,'')) = '' or p_quantity <= 0 or p_unit_price < 0 then
    raise exception 'Revisa la descripción, cantidad y precio del repuesto';
  end if;
  insert into public.parts_requests(order_id,description,quantity,unit_price,from_stock,created_by)
  values(p_order_id,trim(p_description),p_quantity,p_unit_price,coalesce(p_from_stock,false),auth.uid())
  returning id into v_id;
  insert into public.order_events(order_id,event_type,description,actor_id,metadata)
  values(p_order_id,'repuesto','Repuesto solicitado: '||trim(p_description),auth.uid(),jsonb_build_object('part_id',v_id));
  return v_id;
end;
$$;

create or replace function public.set_part_authorization(p_part_id uuid,p_authorized boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_role public.app_role; v_order_id uuid; v_description text;
begin
  select role into v_role from public.profiles where id = auth.uid() and active = true;
  if v_role <> 'admin' then raise exception 'Solo un administrador puede autorizar o rechazar repuestos'; end if;
  update public.parts_requests
     set status = case when p_authorized then 'autorizado'::public.part_status else 'rechazado'::public.part_status end,
         authorized_at = now(), authorized_by = auth.uid()
   where id = p_part_id and status = 'pendiente'
   returning order_id,description into v_order_id,v_description;
  if not found then raise exception 'El repuesto no existe o ya fue procesado'; end if;
  insert into public.order_events(order_id,event_type,description,actor_id,metadata)
  values(v_order_id,'autorizacion',case when p_authorized then 'Repuesto autorizado: ' else 'Repuesto rechazado: ' end||v_description,auth.uid(),jsonb_build_object('part_id',p_part_id,'authorized',p_authorized));
end;
$$;

create or replace function public.mark_part_milestone(p_part_id uuid,p_milestone text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_role public.app_role; v_order_id uuid; v_description text;
begin
  select role into v_role from public.profiles where id = auth.uid() and active = true;
  if v_role not in ('admin','supervisor','tecnico') then raise exception 'No tienes permiso'; end if;
  if p_milestone = 'received' then
    update public.parts_requests set received_at=now(),received_by=auth.uid() where id=p_part_id and status in ('autorizado','comprado');
    v_description := 'Repuesto recibido';
  elsif p_milestone = 'installed' then
    update public.parts_requests set installed_at=now(),installed_by=auth.uid() where id=p_part_id and received_at is not null;
    v_description := 'Repuesto instalado';
  else
    raise exception 'Hito no válido';
  end if;
  if not found then raise exception 'No se pudo registrar el hito. Revisa el estado del repuesto'; end if;
  select order_id into v_order_id from public.parts_requests where id=p_part_id;
  insert into public.order_events(order_id,event_type,description,actor_id,metadata)
  values(v_order_id,p_milestone,v_description,auth.uid(),jsonb_build_object('part_id',p_part_id));
end;
$$;

revoke all on function public.save_order_diagnosis(uuid,text,text) from public;
revoke all on function public.request_order_part(uuid,text,numeric,numeric,boolean) from public;
revoke all on function public.set_part_authorization(uuid,boolean) from public;
revoke all on function public.mark_part_milestone(uuid,text) from public;
grant execute on function public.save_order_diagnosis(uuid,text,text) to authenticated;
grant execute on function public.request_order_part(uuid,text,numeric,numeric,boolean) to authenticated;
grant execute on function public.set_part_authorization(uuid,boolean) to authenticated;
grant execute on function public.mark_part_milestone(uuid,text) to authenticated;

-- Evita que el técnico cambie precios, cobertura de garantía o estado por UPDATE directo.
drop policy if exists "staff update parts" on public.parts_requests;
create policy "admin supervisor update parts" on public.parts_requests
for update to authenticated
using (public.current_role() in ('admin','supervisor'))
with check (public.current_role() in ('admin','supervisor'));

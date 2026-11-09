-- Registro de entrega al cliente para órdenes de Puesta en Marcha.
-- La transición a "entregadas" solo se permite mediante este RPC dedicado.

create or replace function public.guard_commissioning_order_workflow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_is_commissioning boolean;
begin
  if tg_table_name = 'service_orders' then
    if old.commissioning is true and new.commissioning is distinct from true then
      raise exception 'Una orden de Puesta en Marcha no puede convertirse en una orden de reparación';
    end if;
    if old.commissioning is true
       and new.status is distinct from old.status
       and current_setting('app.allow_commissioning_ready', true) is distinct from 'on'
       and current_setting('app.allow_commissioning_delivery', true) is distinct from 'on' then
      raise exception 'Una orden de Puesta en Marcha solo puede cambiar de estado mediante sus confirmaciones dedicadas';
    end if;
    return new;
  end if;

  v_order_id := new.order_id;
  select commissioning into v_is_commissioning
  from public.service_orders
  where id = v_order_id;

  if coalesce(v_is_commissioning, false) then
    if tg_table_name = 'parts_requests' then
      raise exception 'Una Puesta en Marcha no admite solicitudes de repuestos';
    elsif tg_table_name = 'order_diagnosis_reports' then
      raise exception 'Una Puesta en Marcha no requiere informes de diagnóstico';
    elsif tg_table_name = 'payments' then
      raise exception 'Una Puesta en Marcha no admite pagos de reparación';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.confirm_commissioning_delivery(
  p_order_id uuid,
  p_delivered_by_name text,
  p_received_by_name text,
  p_delivery_photo_path text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
  v_order public.service_orders%rowtype;
  v_delivered_by text := btrim(coalesce(p_delivered_by_name, ''));
  v_received_by text := btrim(coalesce(p_received_by_name, ''));
  v_photo_path text := btrim(coalesce(p_delivery_photo_path, ''));
begin
  select role into v_role
  from public.profiles
  where id = auth.uid() and active = true;

  if v_role is null or v_role not in ('admin', 'supervisor') then
    raise exception 'No tienes permiso para registrar la entrega de esta orden';
  end if;

  if v_delivered_by = '' then
    raise exception 'Indica quién entregó el equipo';
  end if;
  if v_received_by = '' then
    raise exception 'Indica quién recibió el equipo';
  end if;
  if v_photo_path = '' or v_photo_path not like p_order_id::text || '/delivery/%' then
    raise exception 'Adjunta una fotografía válida de quien retiró el equipo';
  end if;

  select * into v_order
  from public.service_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'La orden no existe';
  end if;
  if v_order.commissioning is distinct from true then
    raise exception 'Esta orden no está registrada como Puesta en Marcha';
  end if;
  if v_order.status <> 'listas' then
    raise exception 'La entrega solo puede registrarse cuando el equipo está listo para entregar';
  end if;

  perform set_config('app.allow_commissioning_delivery', 'on', true);

  update public.service_orders
  set status = 'entregadas'
  where id = p_order_id;

  insert into public.order_events (
    order_id, event_type, description, metadata, actor_id
  ) values (
    p_order_id,
    'commissioning_delivered',
    'Equipo entregado al cliente',
    jsonb_build_object(
      'previous_status', v_order.status,
      'new_status', 'entregadas',
      'delivered_by_name', v_delivered_by,
      'received_by_name', v_received_by,
      'delivery_photo_path', v_photo_path
    ),
    auth.uid()
  );

  perform set_config('app.allow_commissioning_delivery', 'off', true);
end;
$$;

revoke all on function public.confirm_commissioning_delivery(uuid, text, text, text) from public, anon;
grant execute on function public.confirm_commissioning_delivery(uuid, text, text, text) to authenticated;
revoke all on function public.guard_commissioning_order_workflow() from public, anon, authenticated;

notify pgrst, 'reload schema';

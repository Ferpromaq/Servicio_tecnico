-- Flujo separado para órdenes de Puesta en Marcha.
-- No genera diagnóstico, solicitudes de repuestos ni pagos de reparación.
-- La confirmación de equipo listo debe realizarse mediante el RPC dedicado.

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
    if old.commissioning is true
       and new.status is distinct from old.status
       and current_setting('app.allow_commissioning_ready', true) is distinct from 'on' then
      raise exception 'Una orden de Puesta en Marcha solo puede avanzar mediante la confirmación de equipo listo';
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

drop trigger if exists commissioning_status_guard on public.service_orders;
create trigger commissioning_status_guard
before update of status on public.service_orders
for each row execute function public.guard_commissioning_order_workflow();

drop trigger if exists commissioning_parts_guard on public.parts_requests;
create trigger commissioning_parts_guard
before insert on public.parts_requests
for each row execute function public.guard_commissioning_order_workflow();

drop trigger if exists commissioning_diagnosis_guard on public.order_diagnosis_reports;
create trigger commissioning_diagnosis_guard
before insert on public.order_diagnosis_reports
for each row execute function public.guard_commissioning_order_workflow();

drop trigger if exists commissioning_payments_guard on public.payments;
create trigger commissioning_payments_guard
before insert on public.payments
for each row execute function public.guard_commissioning_order_workflow();

create or replace function public.confirm_commissioning_ready(
  p_order_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
  v_order public.service_orders%rowtype;
begin
  select role into v_role
  from public.profiles
  where id = auth.uid() and active = true;

  if v_role is null or v_role not in ('admin', 'supervisor', 'tecnico') then
    raise exception 'No tienes permiso para confirmar la Puesta en Marcha';
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
  if v_order.status <> 'recepcion' then
    raise exception 'La Puesta en Marcha solo puede confirmarse desde Recepción';
  end if;
  if v_role = 'tecnico' and v_order.assigned_technician is distinct from auth.uid() then
    raise exception 'Solo el técnico asignado puede confirmar que el equipo está listo';
  end if;

  perform set_config('app.allow_commissioning_ready', 'on', true);

  update public.service_orders
  set status = 'listas'
  where id = p_order_id;

  insert into public.order_events (
    order_id, event_type, description, metadata, actor_id
  ) values (
    p_order_id,
    'commissioning_ready',
    'Puesta en Marcha confirmada: equipo listo para entregar',
    jsonb_build_object('previous_status', v_order.status, 'new_status', 'listas'),
    auth.uid()
  );

  perform set_config('app.allow_commissioning_ready', 'off', true);
end;
$$;

revoke all on function public.confirm_commissioning_ready(uuid) from public, anon;
grant execute on function public.confirm_commissioning_ready(uuid) to authenticated;
revoke all on function public.guard_commissioning_order_workflow() from public, anon, authenticated;

notify pgrst, 'reload schema';

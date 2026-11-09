-- Registrar por separado al técnico que realizó las pruebas y al usuario que confirma.
-- El actor_id del evento sigue identificando a quien ejecutó la confirmación.
drop function if exists public.confirm_commissioning_ready(uuid);

create function public.confirm_commissioning_ready(
  p_order_id uuid,
  p_testing_technician_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
  v_order public.service_orders%rowtype;
  v_testing_technician_name text;
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
  if p_testing_technician_id is null then
    raise exception 'Debes seleccionar al técnico que realizó las pruebas';
  end if;

  select full_name into v_testing_technician_name
  from public.profiles
  where id = p_testing_technician_id
    and role = 'tecnico'
    and active = true;

  if v_testing_technician_name is null then
    raise exception 'El técnico seleccionado no existe o no está activo';
  end if;
  if v_role = 'tecnico' and v_order.assigned_technician is distinct from auth.uid() then
    raise exception 'Solo el técnico asignado puede confirmar que el equipo está listo';
  end if;
  if v_role = 'tecnico' and p_testing_technician_id is distinct from auth.uid() then
    raise exception 'El técnico solo puede registrarse a sí mismo como responsable de las pruebas';
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
    jsonb_build_object(
      'previous_status', v_order.status,
      'new_status', 'listas',
      'testing_technician_id', p_testing_technician_id,
      'testing_technician_name', v_testing_technician_name
    ),
    auth.uid()
  );

  perform set_config('app.allow_commissioning_ready', 'off', true);
end;
$$;

revoke all on function public.confirm_commissioning_ready(uuid, uuid) from public, anon;
grant execute on function public.confirm_commissioning_ready(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

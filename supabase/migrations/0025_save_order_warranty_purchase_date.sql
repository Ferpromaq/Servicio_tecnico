-- Completa la fecha de compra de una orden ingresada con garantía.
-- Se entrega como migración independiente porque 0024 puede estar aplicada
-- en instalaciones existentes y las migraciones ya ejecutadas no se repiten.

create or replace function public.save_order_warranty_purchase_date(
  p_order_id uuid,
  p_receipt_date date
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

  if v_role is null or v_role not in ('admin','supervisor') then
    raise exception 'Solo administración o supervisión puede completar la fecha de compra';
  end if;

  select * into v_order
  from public.service_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'La orden no existe';
  end if;

  if not v_order.warranty_entry then
    raise exception 'Esta orden no fue registrada con garantía';
  end if;

  if p_receipt_date is null or p_receipt_date > v_order.received_at::date then
    raise exception 'La fecha de compra debe existir y no puede ser posterior al ingreso del equipo';
  end if;

  update public.service_orders
  set receipt_date = p_receipt_date,
      updated_at = now()
  where id = p_order_id;

  insert into public.order_events(order_id,event_type,description,actor_id,metadata)
  values (
    p_order_id,
    'garantia_fecha_completada',
    'Fecha de compra completada para validar la garantía',
    auth.uid(),
    jsonb_build_object(
      'previous_receipt_date', v_order.receipt_date,
      'receipt_date', p_receipt_date
    )
  );
end;
$$;

revoke all on function public.save_order_warranty_purchase_date(uuid, date) from public, anon;
grant execute on function public.save_order_warranty_purchase_date(uuid, date) to authenticated;

notify pgrst, 'reload schema';

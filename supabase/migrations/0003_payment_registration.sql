-- Registro de pagos con validación de rol, montos pendientes y asignación a repuestos.
create or replace function public.register_order_payment(
  p_order_id uuid,
  p_payment_type public.payment_type,
  p_amount numeric,
  p_method text,
  p_reference text default null,
  p_receipt_received boolean default false,
  p_part_allocations jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
  v_order public.service_orders%rowtype;
  v_payment_id uuid;
  v_allocation record;
  v_existing numeric;
  v_part public.parts_requests%rowtype;
  v_allocated numeric := 0;
  v_warranty_active boolean;
begin
  select role into v_role from public.profiles where id=auth.uid() and active=true;
  if v_role not in ('admin','supervisor') then raise exception 'No tienes permiso para registrar pagos'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'El monto debe ser mayor que cero'; end if;
  select * into v_order from public.service_orders where id=p_order_id for update;
  if not found then raise exception 'La orden no existe'; end if;
  v_warranty_active := coalesce(v_order.warranty_entry,false)
    and v_order.receipt_date is not null
    and v_order.receipt_date between current_date - interval '6 months' and current_date;

  if p_payment_type='diagnostico' then
    if v_warranty_active then raise exception 'El diagnóstico está cubierto por garantía'; end if;
    select coalesce(sum(amount),0) into v_existing from public.payments
      where order_id=p_order_id and payment_type='diagnostico';
    if v_existing + p_amount > v_order.diagnosis_amount then raise exception 'El pago supera el saldo del diagnóstico'; end if;
  elsif p_payment_type='repuestos' then
    if jsonb_typeof(p_part_allocations) <> 'array' or jsonb_array_length(p_part_allocations)=0 then
      raise exception 'Debes distribuir el pago entre repuestos autorizados';
    end if;
    if exists (select 1 from jsonb_to_recordset(p_part_allocations) as x(part_id uuid, amount numeric) group by part_id having count(*) > 1) then
      raise exception 'No repitas un mismo repuesto en la distribución del pago';
    end if;
    for v_allocation in select * from jsonb_to_recordset(p_part_allocations) as x(part_id uuid, amount numeric) loop
      if v_allocation.amount is null or v_allocation.amount <= 0 then raise exception 'Monto de asignación inválido'; end if;
      select * into v_part from public.parts_requests
        where id=v_allocation.part_id and order_id=p_order_id for update;
      if not found then raise exception 'El repuesto no pertenece a esta orden'; end if;
      if v_part.status not in ('autorizado','comprado') or v_part.warranty_covered then
        raise exception 'Solo puedes imputar pagos a repuestos autorizados que no estén cubiertos por garantía';
      end if;
      select coalesce(sum(amount),0) into v_existing from public.payment_parts where part_id=v_part.id;
      if v_existing + v_allocation.amount > v_part.quantity * v_part.unit_price then
        raise exception 'La asignación supera el saldo del repuesto: %', v_part.description;
      end if;
      v_allocated := v_allocated + v_allocation.amount;
    end loop;
    if abs(v_allocated-p_amount)>0.01 then raise exception 'La suma asignada debe coincidir con el monto del pago'; end if;
  end if;

  insert into public.payments(order_id,payment_type,amount,method,reference,receipt_received,registered_by)
  values(p_order_id,p_payment_type,p_amount,nullif(trim(coalesce(p_method,'')),''),nullif(trim(coalesce(p_reference,'')),''),coalesce(p_receipt_received,false),auth.uid())
  returning id into v_payment_id;

  if p_payment_type='repuestos' then
    for v_allocation in select * from jsonb_to_recordset(p_part_allocations) as x(part_id uuid, amount numeric) loop
      insert into public.payment_parts(payment_id,part_id,amount)
      values(v_payment_id,v_allocation.part_id,v_allocation.amount);
    end loop;
  end if;

  insert into public.order_events(order_id,event_type,description,actor_id,metadata)
  values(p_order_id,'pago','Pago registrado: '||p_payment_type||' por '||p_amount,auth.uid(),
    jsonb_build_object('payment_id',v_payment_id,'type',p_payment_type,'amount',p_amount));
  return v_payment_id;
end;
$$;

revoke all on function public.register_order_payment(uuid,public.payment_type,numeric,text,text,boolean,jsonb) from public;
grant execute on function public.register_order_payment(uuid,public.payment_type,numeric,text,text,boolean,jsonb) to authenticated;

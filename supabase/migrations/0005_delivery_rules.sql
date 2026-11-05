-- Completa el control de entrega: instalación, diagnóstico y abono mínimo de repuestos.
alter table public.service_orders
  add column if not exists installation_amount numeric(12,2) not null default 0
  check (installation_amount >= 0);

create or replace function public.transition_order_status(
  p_order_id uuid,
  p_new_status public.order_status,
  p_forced_delivery boolean default false,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
  v_order public.service_orders%rowtype;
  v_warranty_active boolean;
  v_diagnosis_required numeric;
  v_diagnosis_paid numeric;
  v_parts_total numeric;
  v_parts_paid numeric;
  v_installation_paid numeric;
begin
  select role into v_role from public.profiles where id=auth.uid() and active=true;
  if v_role not in ('admin','supervisor') then raise exception 'Solo administración o supervisión puede cambiar el estado de la orden'; end if;

  select * into v_order from public.service_orders where id=p_order_id for update;
  if not found then raise exception 'La orden no existe'; end if;

  if p_forced_delivery and p_new_status <> 'listas' then
    raise exception 'La entrega forzada debe dejar la orden en estado lista para entrega';
  end if;
  if p_forced_delivery and nullif(trim(coalesce(p_reason,'')),'') is null then
    raise exception 'Debes indicar el motivo de la entrega forzada';
  end if;

  if p_new_status='entregadas' then
    if v_order.status <> 'listas' then raise exception 'La orden debe estar lista para entrega antes de marcarla como entregada'; end if;
    v_warranty_active := coalesce(v_order.warranty_entry,false)
      and v_order.receipt_date is not null
      and v_order.receipt_date between current_date - interval '6 months' and current_date;
    v_diagnosis_required := case when v_warranty_active then 0 else v_order.diagnosis_amount end;

    select coalesce(sum(amount),0) into v_diagnosis_paid
      from public.payments where order_id=p_order_id and payment_type='diagnostico';
    if v_diagnosis_paid < v_diagnosis_required then
      raise exception 'Para entregar, el diagnóstico debe estar pagado al 100%%. Pendiente: %',
        greatest(v_diagnosis_required-v_diagnosis_paid,0);
    end if;

    select coalesce(sum(quantity*unit_price),0) into v_parts_total
      from public.parts_requests
      where order_id=p_order_id and status in ('autorizado','comprado') and warranty_covered=false;
    select coalesce(sum(amount),0) into v_parts_paid
      from public.payments where order_id=p_order_id and payment_type='repuestos';
    if v_parts_paid < v_parts_total * 0.60 then
      raise exception 'Para entregar se debe completar al menos el 60%% de los repuestos autorizados. Mínimo: %',
        round(v_parts_total*0.60,0);
    end if;

    select coalesce(sum(amount),0) into v_installation_paid
      from public.payments where order_id=p_order_id and payment_type='instalacion';
    if v_installation_paid < v_order.installation_amount then
      raise exception 'La instalación debe estar pagada al 100%%. Pendiente: %',
        greatest(v_order.installation_amount-v_installation_paid,0);
    end if;
  end if;

  update public.service_orders
     set status=p_new_status,
         forced_delivery=case when p_forced_delivery then true else forced_delivery end,
         forced_delivery_reason=case when p_forced_delivery then trim(p_reason) else forced_delivery_reason end,
         forced_delivery_by=case when p_forced_delivery then auth.uid() else forced_delivery_by end,
         forced_delivery_at=case when p_forced_delivery then now() else forced_delivery_at end,
         delivered_at=case when p_new_status='entregadas' then now() else delivered_at end,
         updated_at=now()
   where id=p_order_id;
  if p_forced_delivery then
    insert into public.order_events(order_id,event_type,description,actor_id,metadata)
    values(p_order_id,'entrega_forzada','Orden lista para entrega por rechazo del cliente: '||trim(p_reason),auth.uid(),jsonb_build_object('reason',trim(p_reason)));
  end if;
end;
$$;

revoke all on function public.transition_order_status(uuid,public.order_status,boolean,text) from public;
grant execute on function public.transition_order_status(uuid,public.order_status,boolean,text) to authenticated;

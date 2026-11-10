-- Evaluación de cobertura de garantía y avance automático del flujo de órdenes.
-- La cobertura se calcula al guardar el diagnóstico y queda como fotografía histórica.

alter table public.service_orders
  add column if not exists damage_caused_by_client boolean,
  add column if not exists diagnosis_covered_by_brand boolean not null default false,
  add column if not exists parts_covered_by_brand boolean not null default false,
  add column if not exists warranty_evaluation_completed_at timestamptz,
  add column if not exists warranty_evaluation_by uuid references public.profiles(id),
  add column if not exists warranty_policy_brand text;

create table if not exists public.brand_warranty_policies (
  brand_key text primary key,
  brand_name text not null,
  diagnosis_covered_when_customer_caused boolean not null default false,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  constraint brand_warranty_policies_key_not_blank check (length(trim(brand_key)) > 0),
  constraint brand_warranty_policies_name_not_blank check (length(trim(brand_name)) > 0)
);

alter table public.brand_warranty_policies enable row level security;
drop policy if exists "staff read brand warranty policies" on public.brand_warranty_policies;
create policy "staff read brand warranty policies"
  on public.brand_warranty_policies for select to authenticated
  using (public.is_staff());
drop policy if exists "admin manage brand warranty policies" on public.brand_warranty_policies;
create policy "admin manage brand warranty policies"
  on public.brand_warranty_policies for all to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- Conserva la cobertura explícita que ya se había evaluado en órdenes antiguas.
update public.service_orders
set damage_caused_by_client = false,
    diagnosis_covered_by_brand = true,
    parts_covered_by_brand = true,
    warranty_evaluation_completed_at = coalesce(updated_at, created_at),
    warranty_policy_brand = (
      select nullif(trim(m.brand), '')
      from public.machines m
      where m.id = service_orders.machine_id
    )
where warranty_entry = true
  and warranty_covers_damage = true
  and receipt_date is not null
  and receipt_date between received_at::date - interval '6 months' and received_at::date
  and warranty_evaluation_completed_at is null;

create or replace function public.save_brand_warranty_policy(
  p_brand text,
  p_diagnosis_covered_when_customer_caused boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
  v_brand text := trim(coalesce(p_brand, ''));
  v_key text;
begin
  select role into v_role
  from public.profiles
  where id = auth.uid() and active = true;

  if v_role is distinct from 'admin' then
    raise exception 'Solo un administrador puede configurar políticas de garantía';
  end if;
  if v_brand = '' then
    raise exception 'Indica la marca que tendrá esta política';
  end if;

  v_key := lower(regexp_replace(v_brand, '\s+', ' ', 'g'));

  insert into public.brand_warranty_policies(
    brand_key, brand_name, diagnosis_covered_when_customer_caused, updated_by, updated_at
  ) values (
    v_key, v_brand, coalesce(p_diagnosis_covered_when_customer_caused, false), auth.uid(), now()
  )
  on conflict (brand_key) do update
  set brand_name = excluded.brand_name,
      diagnosis_covered_when_customer_caused = excluded.diagnosis_covered_when_customer_caused,
      updated_by = auth.uid(),
      updated_at = now();
end;
$$;

drop function if exists public.save_order_diagnosis(uuid, text);
drop function if exists public.save_order_diagnosis(uuid, text, text);

create function public.save_order_diagnosis(
  p_order_id uuid,
  p_diagnosis text,
  p_damage_caused_by_client boolean default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
  v_order public.service_orders%rowtype;
  v_brand text;
  v_warranty_active boolean;
  v_diagnosis_covered boolean := false;
  v_parts_covered boolean := false;
  v_brand_policy boolean := false;
begin
  select role into v_role
  from public.profiles
  where id = auth.uid() and active = true;
  if v_role is null then
    raise exception 'No tienes acceso a esta operación';
  end if;
  if length(trim(coalesce(p_diagnosis, ''))) = 0 then
    raise exception 'El informe de diagnóstico no puede estar vacío';
  end if;

  select * into v_order
  from public.service_orders
  where id = p_order_id
  for update;
  if not found then raise exception 'La orden no existe'; end if;
  if v_order.commissioning then
    raise exception 'Las órdenes de Puesta en Marcha no requieren diagnóstico';
  end if;
  if v_order.warranty_entry and v_order.receipt_date is null then
    raise exception 'Esta orden ingresó con garantía, pero falta la fecha de compra. Administración debe completarla antes del diagnóstico';
  end if;
  if v_order.status in ('listas', 'entregadas', 'rechazadas') then
    raise exception 'No puedes modificar el diagnóstico de una orden cerrada';
  end if;

  select nullif(trim(brand), '')
  into v_brand
  from public.machines
  where id = v_order.machine_id;

  v_warranty_active := coalesce(v_order.warranty_entry, false)
    and v_order.receipt_date is not null
    and v_order.receipt_date between v_order.received_at::date - interval '6 months' and received_at::date;

  if v_warranty_active and p_damage_caused_by_client is null then
    raise exception 'Debes indicar si el daño fue provocado por el cliente para evaluar la garantía';
  end if;

  if v_warranty_active and v_order.status = 'en_reparacion'
     and v_order.warranty_evaluation_completed_at is not null then
    if p_damage_caused_by_client is distinct from v_order.damage_caused_by_client then
      raise exception 'La evaluación de garantía ya está vinculada a solicitudes de reparación y no puede cambiarse desde un nuevo informe';
    end if;
    v_diagnosis_covered := coalesce(v_order.diagnosis_covered_by_brand, false);
    v_parts_covered := coalesce(v_order.parts_covered_by_brand, false);
  elsif v_warranty_active then
    if p_damage_caused_by_client then
      select coalesce(diagnosis_covered_when_customer_caused, false)
      into v_brand_policy
      from public.brand_warranty_policies
      where brand_key = lower(regexp_replace(trim(coalesce(v_brand, '')), '\s+', ' ', 'g'));
      v_diagnosis_covered := coalesce(v_brand_policy, false);
      v_parts_covered := false;
    else
      v_diagnosis_covered := true;
      v_parts_covered := true;
    end if;
  end if;

  insert into public.order_diagnosis_reports(order_id, report, created_by)
  values (p_order_id, trim(p_diagnosis), auth.uid());

  if v_order.status = 'recepcion' then
    perform set_config('app.allow_automatic_order_status', 'on', true);
  end if;

  update public.service_orders
  set diagnosis = trim(p_diagnosis),
      damage_caused_by_client = case when v_warranty_active then p_damage_caused_by_client else null end,
      warranty_covers_damage = case when v_warranty_active then not p_damage_caused_by_client else false end,
      diagnosis_covered_by_brand = v_diagnosis_covered,
      parts_covered_by_brand = v_parts_covered,
      warranty_evaluation_completed_at = case when v_warranty_active then now() else null end,
      warranty_evaluation_by = case when v_warranty_active then auth.uid() else null end,
      warranty_policy_brand = v_brand,
      status = case when status = 'recepcion' then 'diagnostico'::public.order_status else status end,
      updated_at = now()
  where id = p_order_id;
  perform set_config('app.allow_automatic_order_status', 'off', true);

  insert into public.order_events(order_id, event_type, description, actor_id, metadata)
  values (
    p_order_id,
    'diagnostico',
    'Informe de diagnóstico registrado y cobertura de garantía evaluada',
    auth.uid(),
    jsonb_build_object(
      'damage_caused_by_client', case when v_warranty_active then p_damage_caused_by_client else null end,
      'warranty_active', v_warranty_active,
      'brand', v_brand,
      'diagnosis_covered_by_brand', v_diagnosis_covered,
      'parts_covered_by_brand', v_parts_covered
    )
  );
end;
$$;

-- Las solicitudes heredan la cobertura calculada en el diagnóstico.
create or replace function public.request_order_parts(
  p_order_id uuid,
  p_parts jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
  v_order public.service_orders%rowtype;
  v_item jsonb;
  v_description text;
  v_quantity numeric;
  v_unit_price numeric;
  v_from_stock boolean;
  v_catalog_part_id uuid;
  v_catalog_name text;
  v_catalog_active boolean;
  v_part_id uuid;
begin
  select role into v_role
  from public.profiles
  where id = auth.uid() and active = true;
  if v_role is null or v_role not in ('admin','supervisor','tecnico') then
    raise exception 'No tienes permiso para solicitar repuestos';
  end if;

  select * into v_order
  from public.service_orders
  where id = p_order_id
  for update;
  if not found then raise exception 'La orden no existe'; end if;
  if v_order.commissioning then
    raise exception 'Una Puesta en Marcha no admite solicitudes de repuestos';
  end if;
  if v_order.warranty_entry and v_order.receipt_date is null then
    raise exception 'Falta la fecha de compra para validar la garantía antes de solicitar repuestos';
  end if;
  if nullif(trim(coalesce(v_order.diagnosis, '')), '') is null then
    raise exception 'Primero debes completar el diagnóstico';
  end if;
  if v_order.warranty_entry
     and v_order.receipt_date between v_order.received_at::date - interval '6 months' and received_at::date
     and v_order.warranty_evaluation_completed_at is null then
    raise exception 'Primero debes completar la evaluación de garantía del diagnóstico';
  end if;
  if v_order.status not in ('diagnostico','en_reparacion') then
    raise exception 'La orden no está en una etapa que permita solicitar repuestos';
  end if;
  if p_parts is null or jsonb_typeof(p_parts) is distinct from 'array'
     or jsonb_array_length(p_parts) = 0 then
    raise exception 'Agrega al menos un repuesto';
  end if;

  for v_item in select value from jsonb_array_elements(p_parts)
  loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception 'Cada repuesto debe contener datos válidos';
    end if;

    v_catalog_part_id := nullif(v_item->>'catalog_part_id','')::uuid;
    v_description := trim(coalesce(v_item->>'description',''));
    v_quantity := nullif(v_item->>'quantity','')::numeric;
    v_unit_price := nullif(v_item->>'unit_price','')::numeric;
    v_from_stock := coalesce((v_item->>'from_stock')::boolean, false);

    if v_catalog_part_id is not null then
      select name, active into v_catalog_name, v_catalog_active
      from public.parts_catalog where id = v_catalog_part_id;
      if not found or v_catalog_active is distinct from true then
        raise exception 'El repuesto seleccionado no existe o está inactivo en el catálogo';
      end if;
      v_description := v_catalog_name;
      v_from_stock := true;
    end if;

    if v_description = '' or v_quantity is null or v_quantity <= 0
       or v_unit_price is null or v_unit_price < 0 then
      raise exception 'Revisa nombre, cantidad y valor de cada repuesto';
    end if;

    insert into public.parts_requests(
      order_id, description, quantity, unit_price, from_stock,
      catalog_part_id, created_by, warranty_covered
    ) values (
      p_order_id, v_description, v_quantity, v_unit_price, v_from_stock,
      v_catalog_part_id, auth.uid(), coalesce(v_order.parts_covered_by_brand, false)
    )
    returning id into v_part_id;

    insert into public.order_events(order_id, event_type, description, actor_id, metadata)
    values (
      p_order_id, 'repuesto', 'Repuesto solicitado: ' || v_description, auth.uid(),
      jsonb_build_object(
        'part_id', v_part_id, 'catalog_part_id', v_catalog_part_id,
        'quantity', v_quantity, 'unit_price', v_unit_price,
        'from_stock', v_from_stock,
        'warranty_covered', coalesce(v_order.parts_covered_by_brand, false)
      )
    );
  end loop;

  if v_order.status = 'diagnostico' then
    perform set_config('app.allow_automatic_order_status', 'on', true);
    update public.service_orders
    set status = 'en_reparacion', updated_at = now()
    where id = p_order_id;
    perform set_config('app.allow_automatic_order_status', 'off', true);
  end if;
end;
$$;

-- La orden determina si existe cobertura posible; administración puede confirmarla por repuesto.
create or replace function public.update_part_coverage(
  p_part_id uuid,
  p_warranty_covered boolean,
  p_client_contacted boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
  v_order_id uuid;
  v_parts_eligible boolean;
  v_description text;
begin
  select role into v_role
  from public.profiles
  where id = auth.uid() and active = true;
  if v_role is null or v_role not in ('admin','supervisor') then
    raise exception 'Solo administración o supervisión puede actualizar la cobertura del repuesto';
  end if;

  select pr.order_id, pr.description, coalesce(so.parts_covered_by_brand, false)
  into v_order_id, v_description, v_parts_eligible
  from public.parts_requests pr
  join public.service_orders so on so.id = pr.order_id
  where pr.id = p_part_id;
  if not found then raise exception 'El repuesto no existe'; end if;
  if coalesce(p_warranty_covered, false) and not v_parts_eligible then
    raise exception 'La evaluación de esta orden determinó que los repuestos son responsabilidad del cliente';
  end if;

  update public.parts_requests
  set warranty_covered = coalesce(p_warranty_covered, false),
      client_contacted = coalesce(p_client_contacted, false)
  where id = p_part_id;

  insert into public.order_events(order_id, event_type, description, actor_id, metadata)
  values (
    v_order_id, 'garantia_repuesto', 'Cobertura de garantía y contacto actualizados para: ' || v_description,
    auth.uid(),
    jsonb_build_object('part_id', p_part_id, 'warranty_covered', coalesce(p_warranty_covered, false),
                       'client_contacted', coalesce(p_client_contacted, false))
  );
end;
$$;



create or replace function public.start_order_repair(p_order_id uuid)
returns void
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
  if v_role is null or v_role not in ('admin','supervisor','tecnico') then
    raise exception 'No tienes permiso para iniciar la reparación';
  end if;

  select * into v_order
  from public.service_orders
  where id = p_order_id
  for update;
  if not found then raise exception 'La orden no existe'; end if;
  if v_order.commissioning then
    raise exception 'Las órdenes de Puesta en Marcha no requieren reparación';
  end if;
  if v_order.warranty_entry and v_order.receipt_date is null then
    raise exception 'Falta la fecha de compra para validar la garantía antes de iniciar la reparación';
  end if;
  if v_order.status <> 'diagnostico' then
    raise exception 'La orden debe estar en Diagnóstico para iniciar la reparación';
  end if;
  if nullif(trim(coalesce(v_order.diagnosis, '')), '') is null then
    raise exception 'Primero debes completar el diagnóstico';
  end if;
  if v_order.warranty_entry
     and v_order.receipt_date between v_order.received_at::date - interval '6 months' and received_at::date
     and v_order.warranty_evaluation_completed_at is null then
    raise exception 'Falta completar la evaluación de garantía';
  end if;

  perform set_config('app.allow_automatic_order_status', 'on', true);
  update public.service_orders
  set status = 'en_reparacion', updated_at = now()
  where id = p_order_id;
  perform set_config('app.allow_automatic_order_status', 'off', true);

  insert into public.order_events(order_id,event_type,description,actor_id,metadata)
  values (
    p_order_id, 'reparacion_inicio', 'Reparación iniciada', auth.uid(),
    jsonb_build_object('previous_status', v_order.status, 'new_status', 'en_reparacion')
  );
end;
$$;

revoke all on function public.start_order_repair(uuid) from public, anon;
grant execute on function public.start_order_repair(uuid) to authenticated;

-- Registra el fin de reparación como una acción, no como una edición manual del estado.
create or replace function public.mark_order_ready_for_delivery(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
  v_order public.service_orders%rowtype;
  v_diagnosis_paid numeric;
  v_diagnosis_due numeric;
  v_parts_total numeric;
  v_parts_paid numeric;
  v_installation_paid numeric;
begin
  select role into v_role
  from public.profiles
  where id = auth.uid() and active = true;
  if v_role is null or v_role not in ('admin','supervisor','tecnico') then
    raise exception 'No tienes permiso para finalizar la reparación';
  end if;

  select * into v_order
  from public.service_orders
  where id = p_order_id
  for update;
  if not found then raise exception 'La orden no existe'; end if;
  if v_order.commissioning then
    raise exception 'Las órdenes de Puesta en Marcha tienen una confirmación independiente';
  end if;
  if v_order.warranty_entry and v_order.receipt_date is null then
    raise exception 'Falta la fecha de compra para validar la garantía antes de finalizar la reparación';
  end if;
  if v_order.status not in ('diagnostico','en_reparacion') then
    raise exception 'La orden no está en diagnóstico o reparación';
  end if;
  if nullif(trim(coalesce(v_order.diagnosis, '')), '') is null then
    raise exception 'Primero debes completar el diagnóstico';
  end if;
  if v_order.warranty_entry
     and v_order.receipt_date between v_order.received_at::date - interval '6 months' and received_at::date
     and v_order.warranty_evaluation_completed_at is null then
    raise exception 'Falta completar la evaluación de garantía';
  end if;

  if exists (
    select 1 from public.parts_requests
    where order_id = p_order_id
      and (status in ('pendiente','rechazado') or installed_at is null)
  ) then
    raise exception 'Todos los repuestos deben estar autorizados, recibidos e instalados antes de finalizar la reparación';
  end if;

  v_diagnosis_due := case when v_order.diagnosis_covered_by_brand
                          then 0 else coalesce(v_order.diagnosis_amount, 0) end;
  select coalesce(sum(amount), 0) into v_diagnosis_paid
  from public.payments
  where order_id = p_order_id and payment_type = 'diagnostico';
  if v_diagnosis_paid < v_diagnosis_due then
    raise exception 'El diagnóstico debe estar pagado al 100%%. Pendiente: %',
      greatest(v_diagnosis_due - v_diagnosis_paid, 0);
  end if;

  select coalesce(sum(quantity * unit_price), 0) into v_parts_total
  from public.parts_requests
  where order_id = p_order_id
    and status in ('autorizado','comprado')
    and warranty_covered = false;
  select coalesce(sum(amount), 0) into v_parts_paid
  from public.payments
  where order_id = p_order_id and payment_type = 'repuestos';
  if v_parts_paid < v_parts_total * 0.60 then
    raise exception 'Para dejar la orden lista se debe completar al menos el 60%% de los repuestos a cargo del cliente. Mínimo: %',
      round(v_parts_total * 0.60, 0);
  end if;

  select coalesce(sum(amount), 0) into v_installation_paid
  from public.payments
  where order_id = p_order_id and payment_type = 'instalacion';
  if v_installation_paid < coalesce(v_order.installation_amount, 0) then
    raise exception 'La instalación debe estar pagada al 100%%. Pendiente: %',
      greatest(coalesce(v_order.installation_amount, 0) - v_installation_paid, 0);
  end if;

  perform set_config('app.allow_automatic_order_status', 'on', true);
  update public.service_orders
  set status = 'listas', updated_at = now()
  where id = p_order_id;
  perform set_config('app.allow_automatic_order_status', 'off', true);

  insert into public.order_events(order_id, event_type, description, actor_id, metadata)
  values (
    p_order_id, 'reparacion_lista', 'Reparación finalizada: equipo listo para entregar',
    auth.uid(),
    jsonb_build_object(
      'diagnosis_covered_by_brand', v_order.diagnosis_covered_by_brand,
      'parts_covered_by_brand', v_order.parts_covered_by_brand,
      'diagnosis_paid', v_diagnosis_paid,
      'parts_paid', v_parts_paid,
      'installation_paid', v_installation_paid
    )
  );
end;
$$;

-- Las validaciones de pago consultan la cobertura evaluada, no la mera vigencia de la factura.
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
begin
  select role into v_role from public.profiles where id = auth.uid() and active = true;
  if v_role is null or v_role not in ('admin','supervisor') then
    raise exception 'No tienes permiso para registrar pagos';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'El monto debe ser mayor que cero'; end if;

  select * into v_order from public.service_orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe'; end if;

  if p_payment_type = 'diagnostico' then
    if v_order.diagnosis_covered_by_brand then
      raise exception 'El diagnóstico está cubierto por la marca';
    end if;
    select coalesce(sum(amount), 0) into v_existing
    from public.payments where order_id = p_order_id and payment_type = 'diagnostico';
    if v_existing + p_amount > coalesce(v_order.diagnosis_amount, 0) then
      raise exception 'El pago supera el saldo del diagnóstico';
    end if;
  elsif p_payment_type = 'repuestos' then
    if jsonb_typeof(p_part_allocations) is distinct from 'array'
       or jsonb_array_length(p_part_allocations) = 0 then
      raise exception 'Debes distribuir el pago entre repuestos autorizados';
    end if;
    if exists (
      select 1 from jsonb_to_recordset(p_part_allocations) as x(part_id uuid, amount numeric)
      group by part_id having count(*) > 1
    ) then
      raise exception 'No repitas un mismo repuesto en la distribución del pago';
    end if;

    for v_allocation in
      select * from jsonb_to_recordset(p_part_allocations) as x(part_id uuid, amount numeric)
    loop
      if v_allocation.amount is null or v_allocation.amount <= 0 then
        raise exception 'Monto de asignación inválido';
      end if;
      select * into v_part from public.parts_requests
      where id = v_allocation.part_id and order_id = p_order_id
      for update;
      if not found then raise exception 'El repuesto no pertenece a esta orden'; end if;
      if v_part.status not in ('autorizado','comprado') or v_part.warranty_covered then
        raise exception 'Solo puedes imputar pagos a repuestos autorizados que estén a cargo del cliente';
      end if;
      select coalesce(sum(amount), 0) into v_existing
      from public.payment_parts where part_id = v_part.id;
      if v_existing + v_allocation.amount > v_part.quantity * v_part.unit_price then
        raise exception 'La asignación supera el saldo del repuesto: %', v_part.description;
      end if;
      v_allocated := v_allocated + v_allocation.amount;
    end loop;

    if abs(v_allocated - p_amount) > 0.01 then
      raise exception 'La suma asignada debe coincidir con el monto del pago';
    end if;
  end if;

  insert into public.payments(
    order_id, payment_type, amount, method, reference, receipt_received, registered_by
  ) values (
    p_order_id, p_payment_type, p_amount,
    nullif(trim(coalesce(p_method, '')), ''),
    nullif(trim(coalesce(p_reference, '')), ''),
    coalesce(p_receipt_received, false), auth.uid()
  )
  returning id into v_payment_id;

  if p_payment_type = 'repuestos' then
    for v_allocation in
      select * from jsonb_to_recordset(p_part_allocations) as x(part_id uuid, amount numeric)
    loop
      insert into public.payment_parts(payment_id, part_id, amount)
      values (v_payment_id, v_allocation.part_id, v_allocation.amount);
    end loop;
  end if;

  insert into public.order_events(order_id, event_type, description, actor_id, metadata)
  values (
    p_order_id, 'pago', 'Pago registrado: ' || p_payment_type || ' por ' || p_amount,
    auth.uid(),
    jsonb_build_object('payment_id', v_payment_id, 'type', p_payment_type, 'amount', p_amount)
  );
  return v_payment_id;
end;
$$;



-- Los cambios manuales de etapa dejan de estar disponibles. Solo se conservan
-- las acciones de negocio: rechazo de reparación, entrega forzada y entrega real.
create or replace function public.transition_order_status(
  p_order_id uuid,
  p_new_status public.order_status,
  p_forced_delivery boolean default false,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = publicas $$
declare
  v_role public.app_role;
  v_order public.service_orders%rowtype;
  v_diagnosis_required numeric;
  v_diagnosis_paid numeric;
  v_parts_total numeric;
  v_parts_paid numeric;
  v_installation_paid numeric;
begin
  select role into v_role from public.profiles where id = auth.uid() and active = true;
  if v_role is null or v_role not in ('admin','supervisor') then
    raise exception 'Solo administración o supervisión puede registrar esta acción';
  end if;

  select * into v_order from public.service_orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe'; end if;

  if p_new_status not in ('listas','entregadas','rechazadas') then
    raise exception 'El estado de la orden avanza automáticamente según las acciones del servicio';
  end if;
  if p_forced_delivery and p_new_status <> 'listas' then
    raise exception 'La entrega forzada debe dejar la orden lista para entrega';
  end if;
  if p_new_status = 'listas' and not p_forced_delivery then
    raise exception 'Para finalizar una reparación utiliza la confirmación de reparación terminada';
  end if;
  if p_new_status = 'entregadas' and v_order.status <> 'listas' then
    raise exception 'La orden debe estar lista para entrega antes de registrar su entrega';
  end if;
  if p_new_status = 'rechazadas' and nullif(trim(coalesce(p_reason,'')), '') is null then
    raise exception 'Indica el motivo por el que se rechaza la orden';
  end if;
  if p_forced_delivery and nullif(trim(coalesce(p_reason,'')), '') is null then
    raise exception 'Debes indicar por qué el cliente rechazó la reparación';
  end if;

  if p_new_status in ('listas','entregadas') then
    if v_order.warranty_entry and v_order.receipt_date is null then
      raise exception 'Falta la fecha de compra para validar la garantía antes de entregar';
    end if;
    v_diagnosis_required := case
      when v_order.diagnosis_covered_by_brand then 0
      else coalesce(v_order.diagnosis_amount, 0)
    end;
    select coalesce(sum(amount),0) into v_diagnosis_paid
    from public.payments
    where order_id = p_order_id and payment_type = 'diagnostico';
    if v_diagnosis_paid < v_diagnosis_required then
      raise exception 'El diagnóstico debe estar pagado al 100%%. Pendiente: %',
        greatest(v_diagnosis_required - v_diagnosis_paid, 0);
    end if;

    select coalesce(sum(quantity * unit_price),0) into v_parts_total
    from public.parts_requests
    where order_id = p_order_id
      and status in ('autorizado','comprado')
      and warranty_covered = false;
    select coalesce(sum(amount),0) into v_parts_paid
    from public.payments
    where order_id = p_order_id and payment_type = 'repuestos';
    if v_parts_paid < v_parts_total * 0.60 then
      raise exception 'Para entregar se debe completar al menos el 60%% de los repuestos a cargo del cliente. Mínimo: %',
        round(v_parts_total * 0.60, 0);
    end if;

    select coalesce(sum(amount),0) into v_installation_paid
    from public.payments
    where order_id = p_order_id and payment_type = 'instalacion';
    if v_installation_paid < coalesce(v_order.installation_amount, 0) then
      raise exception 'La instalación debe estar pagada al 100%%. Pendiente: %',
        greatest(coalesce(v_order.installation_amount, 0) - v_installation_paid, 0);
    end if;
  end if;

  perform set_config('app.allow_automatic_order_status', 'on', true);
  update public.service_orders
  set status = p_new_status,
      forced_delivery = case when p_forced_delivery then true else forced_delivery end,
      forced_delivery_reason = case when p_forced_delivery then trim(p_reason) else forced_delivery_reason end,
      forced_delivery_by = case when p_forced_delivery then auth.uid() else forced_delivery_by end,
      forced_delivery_at = case when p_forced_delivery then now() else forced_delivery_at end,
      delivered_at = case when p_new_status = 'entregadas' then now() else delivered_at end,
      updated_at = now()
  where id = p_order_id;
  perform set_config('app.allow_automatic_order_status', 'off', true);

  if p_forced_delivery then
    insert into public.order_events(order_id,event_type,description,actor_id,metadata)
    values (
      p_order_id, 'entrega_forzada',
      'Orden lista para entrega por rechazo del cliente: ' || trim(p_reason),
      auth.uid(), jsonb_build_object('reason', trim(p_reason))
    );
  elsif p_new_status = 'rechazadas' then
    insert into public.order_events(order_id,event_type,description,actor_id,metadata)
    values (
      p_order_id, 'orden_rechazada',
      'Orden rechazada: ' || trim(p_reason),
      auth.uid(), jsonb_build_object('reason', trim(p_reason))
    );
  end if;
end;
$$;

revoke all on function public.transition_order_status(uuid, public.order_status, boolean, text) from public, anon;
grant execute on function public.transition_order_status(uuid, public.order_status, boolean, text) to authenticated;



-- Impide que un UPDATE directo vuelva a introducir cambios manuales de estado.
create or replace function public.guard_automatic_order_status()
returns trigger
language plpgsql
security definer
set search_path = publicas $$
begin
  if old.status is distinct from new.status
     and current_setting('app.allow_automatic_order_status', true) is distinct from 'on'
     and current_setting('app.allow_commissioning_ready', true) is distinct from 'on'
     and current_setting('app.allow_commissioning_delivery', true) is distinct from 'on' then
    raise exception 'El estado de la orden solo puede avanzar mediante las acciones del flujo de servicio';
  end if;
  return new;
end;
$$;

drop trigger if exists automatic_order_status_guard on public.service_orders;
create trigger automatic_order_status_guard
before update of status on public.service_orders
for each row execute function public.guard_automatic_order_status();

revoke all on function public.guard_automatic_order_status() from public, anon, authenticated;
grant select on public.brand_warranty_policies to authenticated;



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
  if not found then raise exception 'La orden no existe'; end if;
  if not v_order.warranty_entry then
    raise exception 'Esta orden no fue registrada con garantía';
  end if;
  if p_receipt_date is null or p_receipt_date > v_order.received_at::date then
    raise exception 'La fecha de compra debe existir y no puede ser posterior al ingreso del equipo';
  end if;

  update public.service_orders
  set receipt_date = p_receipt_date, updated_at = now()
  where id = p_order_id;

  insert into public.order_events(order_id,event_type,description,actor_id,metadata)
  values (
    p_order_id, 'garantia_fecha_completada', 'Fecha de compra completada para validar la garantía',
    auth.uid(),
    jsonb_build_object('previous_receipt_date', v_order.receipt_date, 'receipt_date', p_receipt_date)
  );
end;
$$;

revoke all on function public.save_order_warranty_purchase_date(uuid, date) from public, anon;
grant execute on function public.save_order_warranty_purchase_date(uuid, date) to authenticated;

revoke all on function public.save_brand_warranty_policy(text, boolean) from public, anon;
grant execute on function public.save_brand_warranty_policy(text, boolean) to authenticated;
revoke all on function public.save_order_diagnosis(uuid, text, boolean) from public, anon;
grant execute on function public.save_order_diagnosis(uuid, text, boolean) to authenticated;
revoke all on function public.request_order_parts(uuid, jsonb) from public, anon;
grant execute on function public.request_order_parts(uuid, jsonb) to authenticated;
revoke all on function public.update_part_coverage(uuid, boolean, boolean) from public, anon;
grant execute on function public.update_part_coverage(uuid, boolean, boolean) to authenticated;
revoke all on function public.mark_order_ready_for_delivery(uuid) from public, anon;
grant execute on function public.mark_order_ready_for_delivery(uuid) to authenticated;
revoke all on function public.register_order_payment(uuid, public.payment_type, numeric, text, text, boolean, jsonb) from public, anon;
grant execute on function public.register_order_payment(uuid, public.payment_type, numeric, text, text, boolean, jsonb) to authenticated;

notify pgrst, 'reload schema';

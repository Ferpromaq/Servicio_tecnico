-- Cobros de servicios prestados a marcas (independientes de pagos de clientes).
alter table public.service_orders
  add column if not exists demo_batch_id uuid;

create table if not exists public.brand_charges (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.service_orders(id) on delete cascade,
  brand_name text not null,
  service_type text not null check (service_type in ('diagnostico','puesta_en_marcha')),
  service_date date not null default current_date,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'por_preparar'
    check (status in ('por_preparar','enviado','aceptado','rechazado','pagado')),
  reference text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_charges_service_unique unique(order_id, service_type)
);

create table if not exists public.brand_charge_payments (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null references public.brand_charges(id) on delete cascade,
  amount numeric(12,2) not null check(amount > 0),
  paid_at timestamptz not null default now(),
  method text,
  reference text,
  notes text,
  registered_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.brand_charge_events (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null references public.brand_charges(id) on delete cascade,
  event_type text not null,
  description text not null,
  metadata jsonb not null default '{}',
  actor_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.brand_charges enable row level security;
alter table public.brand_charge_payments enable row level security;
alter table public.brand_charge_events enable row level security;

drop policy if exists "finance read brand charges" on public.brand_charges;
create policy "finance read brand charges" on public.brand_charges
  for select to authenticated using (public.current_role() in ('admin','supervisor'));
drop policy if exists "finance create brand charges" on public.brand_charges;
create policy "finance create brand charges" on public.brand_charges
  for insert to authenticated with check (public.current_role() in ('admin','supervisor'));
drop policy if exists "finance update brand charges" on public.brand_charges;
create policy "finance update brand charges" on public.brand_charges
  for update to authenticated using (public.current_role() in ('admin','supervisor'))
  with check (public.current_role() in ('admin','supervisor'));

drop policy if exists "finance read brand charge payments" on public.brand_charge_payments;
create policy "finance read brand charge payments" on public.brand_charge_payments
  for select to authenticated using (public.current_role() in ('admin','supervisor'));
drop policy if exists "finance create brand charge payments" on public.brand_charge_payments;
create policy "finance create brand charge payments" on public.brand_charge_payments
  for insert to authenticated with check (public.current_role() in ('admin','supervisor'));

drop policy if exists "finance read brand charge events" on public.brand_charge_events;
create policy "finance read brand charge events" on public.brand_charge_events
  for select to authenticated using (public.current_role() in ('admin','supervisor'));
drop policy if exists "finance create brand charge events" on public.brand_charge_events;
create policy "finance create brand charge events" on public.brand_charge_events
  for insert to authenticated with check (public.current_role() in ('admin','supervisor'));

grant select, insert, update on public.brand_charges to authenticated;
grant select, insert on public.brand_charge_payments to authenticated;
grant select, insert on public.brand_charge_events to authenticated;

create index if not exists brand_charges_status_idx on public.brand_charges(status, created_at desc);
create index if not exists brand_charges_order_idx on public.brand_charges(order_id);
create index if not exists brand_charge_payments_charge_idx on public.brand_charge_payments(charge_id, paid_at desc);

create or replace function public.register_brand_charge_payment(
  p_charge_id uuid, p_amount numeric, p_method text default null,
  p_reference text default null, p_notes text default null
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_role public.app_role;
  v_charge public.brand_charges%rowtype;
  v_paid numeric;
  v_payment_id uuid;
begin
  select role into v_role from public.profiles where id=auth.uid() and active=true;
  if v_role is null or v_role not in ('admin','supervisor') then
    raise exception 'No tienes permiso para registrar pagos de marcas';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'El monto debe ser mayor que cero'; end if;
  select * into v_charge from public.brand_charges where id=p_charge_id for update;
  if not found then raise exception 'El cobro no existe'; end if;
  if v_charge.status = 'rechazado' then raise exception 'No puedes recibir pagos de un cobro rechazado'; end if;
  select coalesce(sum(amount),0) into v_paid from public.brand_charge_payments where charge_id=p_charge_id;
  if v_paid + p_amount > v_charge.amount then raise exception 'El pago supera el saldo pendiente'; end if;
  insert into public.brand_charge_payments(charge_id,amount,method,reference,notes,registered_by)
  values(p_charge_id,p_amount,nullif(trim(coalesce(p_method,'')),''),nullif(trim(coalesce(p_reference,'')),''),nullif(trim(coalesce(p_notes,'')),''),auth.uid())
  returning id into v_payment_id;
  if v_paid + p_amount >= v_charge.amount then
    update public.brand_charges set status='pagado',updated_at=now() where id=p_charge_id;
  end if;
  insert into public.brand_charge_events(charge_id,event_type,description,metadata,actor_id)
  values(p_charge_id,'pago_marca','Pago de marca registrado',jsonb_build_object('payment_id',v_payment_id,'amount',p_amount),auth.uid());
  return v_payment_id;
end;
$$;

revoke all on function public.register_brand_charge_payment(uuid,numeric,text,text,text) from public, anon;
grant execute on function public.register_brand_charge_payment(uuid,numeric,text,text,text) to authenticated;

create or replace function public.set_brand_charge_status(
  p_charge_id uuid, p_status text, p_reference text default null, p_notes text default null
) returns void
language plpgsql security definer set search_path=public as $$
declare v_role public.app_role; v_charge public.brand_charges%rowtype;
begin
  select role into v_role from public.profiles where id=auth.uid() and active=true;
  if v_role is null or v_role not in ('admin','supervisor') then raise exception 'No tienes permiso para actualizar cobros'; end if;
  if p_status not in ('por_preparar','enviado','aceptado','rechazado') then
    raise exception 'Estado de cobro no válido';
  end if;
  select * into v_charge from public.brand_charges where id=p_charge_id for update;
  if not found then raise exception 'El cobro no existe'; end if;
  if v_charge.status='pagado' then raise exception 'Un cobro pagado no puede cambiar de estado'; end if;
  update public.brand_charges set status=p_status,
    reference=coalesce(nullif(trim(coalesce(p_reference,'')),''),reference),
    notes=coalesce(nullif(trim(coalesce(p_notes,'')),''),notes),updated_at=now()
  where id=p_charge_id;
  insert into public.brand_charge_events(charge_id,event_type,description,metadata,actor_id)
  values(p_charge_id,'estado','Estado del cobro actualizado a '||p_status,
    jsonb_build_object('from',v_charge.status,'to',p_status,'reference',p_reference,'notes',p_notes),auth.uid());
end;
$$;

revoke all on function public.set_brand_charge_status(uuid,text,text,text) from public, anon;
grant execute on function public.set_brand_charge_status(uuid,text,text,text) to authenticated;
notify pgrst, 'reload schema';

-- Catálogo independiente de repuestos y trazabilidad de procedencia/costos.
-- No administra existencias ni descuenta cantidades.
-- Los costos se registran como eventos append-only: corregir un costo agrega
-- un nuevo registro y conserva el historial anterior.

create table if not exists public.parts_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  internal_code text,
  brand text,
  model text,
  description text,
  sale_price numeric(12,2) check (sale_price is null or sale_price >= 0),
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create unique index if not exists parts_catalog_internal_code_unique
  on public.parts_catalog (lower(trim(internal_code)))
  where internal_code is not null and trim(internal_code) <> '';

create index if not exists parts_catalog_name_idx
  on public.parts_catalog (lower(name));

create table if not exists public.part_acquisition_records (
  id uuid primary key default gen_random_uuid(),
  catalog_part_id uuid references public.parts_catalog(id) on delete restrict,
  part_request_id uuid references public.parts_requests(id) on delete restrict,
  origin text not null check (origin in (
    'compra_reparacion',
    'propiedad_ferpromaq',
    'garantia_proveedor',
    'aportado_cliente',
    'otro'
  )),
  cost_responsibility text not null check (cost_responsibility in (
    'ferpromaq',
    'cliente',
    'proveedor',
    'otro'
  )),
  purchase_cost numeric(12,2) check (purchase_cost is null or purchase_cost >= 0),
  notes text,
  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default now(),
  constraint part_acquisition_target_check
    check (catalog_part_id is not null or part_request_id is not null)
);

create index if not exists part_acquisition_catalog_history_idx
  on public.part_acquisition_records (catalog_part_id, recorded_at desc);

create index if not exists part_acquisition_request_history_idx
  on public.part_acquisition_records (part_request_id, recorded_at desc);

alter table public.parts_requests
  add column if not exists catalog_part_id uuid
    references public.parts_catalog(id) on delete set null;

create index if not exists parts_requests_catalog_part_idx
  on public.parts_requests (catalog_part_id);

alter table public.parts_catalog enable row level security;
alter table public.part_acquisition_records enable row level security;

drop policy if exists "staff read parts catalog" on public.parts_catalog;
create policy "staff read parts catalog"
  on public.parts_catalog for select to authenticated
  using (public.is_staff());

drop policy if exists "staff read part acquisition records" on public.part_acquisition_records;
create policy "staff read part acquisition records"
  on public.part_acquisition_records for select to authenticated
  using (public.is_staff());

revoke all on public.parts_catalog from public, anon, authenticated;
revoke all on public.part_acquisition_records from public, anon, authenticated;
grant select on public.parts_catalog to authenticated;
grant select on public.part_acquisition_records to authenticated;

create or replace function public.create_catalog_part(
  p_name text,
  p_internal_code text default null,
  p_brand text default null,
  p_model text default null,
  p_description text default null,
  p_sale_price numeric default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
  v_id uuid;
begin
  select role into v_role
  from public.profiles
  where id = auth.uid() and active = true;

  if v_role is null or v_role not in ('admin','supervisor') then
    raise exception 'Solo administración o supervisión puede crear repuestos en el catálogo';
  end if;
  if nullif(trim(coalesce(p_name,'')), '') is null then
    raise exception 'El nombre del repuesto es obligatorio';
  end if;
  if p_sale_price is not null and p_sale_price < 0 then
    raise exception 'El precio de venta no puede ser negativo';
  end if;

  insert into public.parts_catalog (
    name, internal_code, brand, model, description, sale_price, created_by, updated_by
  ) values (
    trim(p_name), nullif(trim(coalesce(p_internal_code,'')), ''),
    nullif(trim(coalesce(p_brand,'')), ''), nullif(trim(coalesce(p_model,'')), ''),
    nullif(trim(coalesce(p_description,'')), ''), p_sale_price, auth.uid(), auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.update_catalog_part(
  p_part_id uuid,
  p_name text,
  p_internal_code text default null,
  p_brand text default null,
  p_model text default null,
  p_description text default null,
  p_sale_price numeric default null,
  p_active boolean default true
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
begin
  select role into v_role
  from public.profiles
  where id = auth.uid() and active = true;

  if v_role is null or v_role not in ('admin','supervisor') then
    raise exception 'Solo administración o supervisión puede editar el catálogo';
  end if;
  if nullif(trim(coalesce(p_name,'')), '') is null then
    raise exception 'El nombre del repuesto es obligatorio';
  end if;
  if p_sale_price is not null and p_sale_price < 0 then
    raise exception 'El precio de venta no puede ser negativo';
  end if;

  update public.parts_catalog
  set name = trim(p_name),
      internal_code = nullif(trim(coalesce(p_internal_code,'')), ''),
      brand = nullif(trim(coalesce(p_brand,'')), ''),
      model = nullif(trim(coalesce(p_model,'')), ''),
      description = nullif(trim(coalesce(p_description,'')), ''),
      sale_price = p_sale_price,
      active = coalesce(p_active, true),
      updated_by = auth.uid(),
      updated_at = now()
  where id = p_part_id;

  if not found then raise exception 'El repuesto no existe en el catálogo'; end if;
end;
$$;

create or replace function public.link_order_part_to_catalog(
  p_part_request_id uuid,
  p_catalog_part_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
begin
  select role into v_role
  from public.profiles
  where id = auth.uid() and active = true;

  if v_role is null or v_role not in ('admin','supervisor','tecnico') then
    raise exception 'No tienes permiso para vincular repuestos';
  end if;
  if not exists (select 1 from public.parts_catalog where id = p_catalog_part_id and active = true) then
    raise exception 'El repuesto del catálogo no existe o está inactivo';
  end if;

  update public.parts_requests
  set catalog_part_id = p_catalog_part_id
  where id = p_part_request_id;

  if not found then raise exception 'La solicitud de repuesto no existe'; end if;
end;
$$;

create or replace function public.record_part_acquisition(
  p_catalog_part_id uuid default null,
  p_part_request_id uuid default null,
  p_origin text default 'otro',
  p_cost_responsibility text default 'ferpromaq',
  p_purchase_cost numeric default null,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
  v_catalog_part_id uuid;
  v_id uuid;
begin
  select role into v_role
  from public.profiles
  where id = auth.uid() and active = true;

  if v_role is distinct from 'admin' then
    raise exception 'Solo un administrador puede registrar o corregir costos de adquisición';
  end if;
  if p_catalog_part_id is null and p_part_request_id is null then
    raise exception 'Debes asociar el registro a un repuesto del catálogo o a una solicitud de orden';
  end if;
  if p_origin not in ('compra_reparacion','propiedad_ferpromaq','garantia_proveedor','aportado_cliente','otro') then
    raise exception 'Procedencia de repuesto no válida';
  end if;
  if p_cost_responsibility not in ('ferpromaq','cliente','proveedor','otro') then
    raise exception 'Responsable del costo no válido';
  end if;
  if p_purchase_cost is not null and p_purchase_cost < 0 then
    raise exception 'El costo de compra no puede ser negativo';
  end if;

  if p_part_request_id is not null then
    select catalog_part_id into v_catalog_part_id
    from public.parts_requests
    where id = p_part_request_id;
    if not found then raise exception 'La solicitud de repuesto no existe'; end if;
    if p_catalog_part_id is not null and v_catalog_part_id is not null
       and v_catalog_part_id <> p_catalog_part_id then
      raise exception 'El repuesto de catálogo no coincide con la solicitud';
    end if;
    v_catalog_part_id := coalesce(p_catalog_part_id, v_catalog_part_id);
  else
    v_catalog_part_id := p_catalog_part_id;
  end if;

  if v_catalog_part_id is not null and not exists (
    select 1 from public.parts_catalog where id = v_catalog_part_id
  ) then
    raise exception 'El repuesto del catálogo no existe';
  end if;

  insert into public.part_acquisition_records (
    catalog_part_id, part_request_id, origin, cost_responsibility,
    purchase_cost, notes, recorded_by
  ) values (
    v_catalog_part_id, p_part_request_id, p_origin, p_cost_responsibility,
    p_purchase_cost, nullif(trim(coalesce(p_notes,'')), ''), auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.prevent_part_acquisition_record_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'El historial de procedencia y costos es inmutable; registra una nueva corrección para conservar la trazabilidad';
end;
$$;

drop trigger if exists part_acquisition_records_immutable on public.part_acquisition_records;
create trigger part_acquisition_records_immutable
  before update or delete on public.part_acquisition_records
  for each row execute function public.prevent_part_acquisition_record_mutation();

revoke all on function public.create_catalog_part(text,text,text,text,text,numeric) from public, anon;
revoke all on function public.update_catalog_part(uuid,text,text,text,text,text,numeric,boolean) from public, anon;
revoke all on function public.link_order_part_to_catalog(uuid,uuid) from public, anon;
revoke all on function public.record_part_acquisition(uuid,uuid,text,text,numeric,text) from public, anon;
revoke all on function public.prevent_part_acquisition_record_mutation() from public, anon, authenticated;

grant execute on function public.create_catalog_part(text,text,text,text,text,numeric) to authenticated;
grant execute on function public.update_catalog_part(uuid,text,text,text,text,text,numeric,boolean) to authenticated;
grant execute on function public.link_order_part_to_catalog(uuid,uuid) to authenticated;
grant execute on function public.record_part_acquisition(uuid,uuid,text,text,numeric,text) to authenticated;

notify pgrst, 'reload schema';

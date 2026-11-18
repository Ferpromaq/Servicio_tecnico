-- Catalogo independiente de repuestos y trazabilidad de costos.
-- No administra existencias ni descuenta cantidades.

create table if not exists public.parts_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  description text,
  internal_code text,
  brand text,
  model text,
  sale_price numeric(12,2) check (sale_price is null or sale_price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

create unique index if not exists parts_catalog_internal_code_unique
  on public.parts_catalog (lower(trim(internal_code)))
  where internal_code is not null and trim(internal_code) <> '';

create table if not exists public.parts_catalog_cost_records (
  id uuid primary key default gen_random_uuid(),
  catalog_part_id uuid not null references public.parts_catalog(id) on delete restrict,
  origin text not null check (origin in (
    'compra_reparacion', 'existente_ferpromaq', 'garantia_proveedor',
    'aportado_cliente', 'otro'
  )),
  cost_responsibility text not null check (cost_responsibility in (
    'ferpromaq', 'cliente', 'proveedor', 'otro'
  )),
  purchase_cost numeric(12,2) check (purchase_cost is null or purchase_cost >= 0),
  note text,
  supersedes_id uuid references public.parts_catalog_cost_records(id),
  recorded_at timestamptz not null default now(),
  recorded_by uuid references public.profiles(id)
);

create index if not exists parts_catalog_cost_records_part_date_idx
  on public.parts_catalog_cost_records(catalog_part_id, recorded_at desc);

alter table public.parts_requests
  add column if not exists catalog_part_id uuid references public.parts_catalog(id) on delete set null,
  add column if not exists origin text,
  add column if not exists cost_responsibility text,
  add column if not exists purchase_cost numeric(12,2),
  add column if not exists cost_record_id uuid references public.parts_catalog_cost_records(id) on delete set null;

alter table public.parts_catalog enable row level security;
alter table public.parts_catalog_cost_records enable row level security;

drop policy if exists "staff read parts catalog" on public.parts_catalog;
create policy "staff read parts catalog"
  on public.parts_catalog for select to authenticated
  using (public.is_staff());

drop policy if exists "staff read parts catalog cost records" on public.parts_catalog_cost_records;
create policy "staff read parts catalog cost records"
  on public.parts_catalog_cost_records for select to authenticated
  using (public.is_staff());

revoke all on public.parts_catalog from public, anon, authenticated;
revoke all on public.parts_catalog_cost_records from public, anon, authenticated;
grant select on public.parts_catalog to authenticated;
grant select on public.parts_catalog_cost_records to authenticated;

create or replace function public.save_parts_catalog_item(
  p_id uuid,
  p_name text,
  p_description text default null,
  p_internal_code text default null,
  p_brand text default null,
  p_model text default null,
  p_sale_price numeric default null,
  p_active boolean default true
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
    raise exception 'No tienes permiso para gestionar el catálogo';
  end if;
  if nullif(trim(coalesce(p_name,'')), '') is null then
    raise exception 'El nombre del repuesto es obligatorio';
  end if;
  if p_sale_price is not null and p_sale_price < 0 then
    raise exception 'El precio de venta no puede ser negativo';
  end if;

  if p_id is null then
    insert into public.parts_catalog(
      name, description, internal_code, brand, model, sale_price,
      active, created_by, updated_by
    ) values (
      trim(p_name), nullif(trim(p_description), ''),
      nullif(trim(p_internal_code), ''), nullif(trim(p_brand), ''),
      nullif(trim(p_model), ''), p_sale_price, coalesce(p_active,true),
      auth.uid(), auth.uid()
    ) returning id into v_id;
  else
    update public.parts_catalog
       set name = trim(p_name),
           description = nullif(trim(p_description), ''),
           internal_code = nullif(trim(p_internal_code), ''),
           brand = nullif(trim(p_brand), ''),
           model = nullif(trim(p_model), ''),
           sale_price = p_sale_price,
           active = coalesce(p_active,true),
           updated_at = now(),
           updated_by = auth.uid()
     where id = p_id
     returning id into v_id;
    if not found then raise exception 'El repuesto no existe en el catálogo'; end if;
  end if;

  return v_id;
end;
$$;

create or replace function public.record_parts_catalog_cost(
  p_catalog_part_id uuid,
  p_origin text,
  p_cost_responsibility text,
  p_purchase_cost numeric default null,
  p_note text default null,
  p_supersedes_id uuid default null
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

  if v_role is distinct from 'admin' then
    raise exception 'Solo un administrador puede registrar o corregir costos de compra';
  end if;
  if not exists (select 1 from public.parts_catalog where id = p_catalog_part_id) then
    raise exception 'El repuesto no existe en el catálogo';
  end if;
  if p_origin not in ('compra_reparacion','existente_ferpromaq','garantia_proveedor','aportado_cliente','otro') then
    raise exception 'Procedencia no válida';
  end if;
  if p_cost_responsibility not in ('ferpromaq','cliente','proveedor','otro') then
    raise exception 'Responsable del costo no válido';
  end if;
  if p_purchase_cost is not null and p_purchase_cost < 0 then
    raise exception 'El costo de compra no puede ser negativo';
  end if;
  if p_supersedes_id is not null and not exists (
    select 1 from public.parts_catalog_cost_records
    where id = p_supersedes_id and catalog_part_id = p_catalog_part_id
  ) then
    raise exception 'El registro de costo que intentas corregir no corresponde a este repuesto';
  end if;

  insert into public.parts_catalog_cost_records(
    catalog_part_id, origin, cost_responsibility, purchase_cost,
    note, supersedes_id, recorded_by
  ) values (
    p_catalog_part_id, p_origin, p_cost_responsibility, p_purchase_cost,
    nullif(trim(p_note), ''), p_supersedes_id, auth.uid()
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.save_parts_catalog_item(uuid,text,text,text,text,text,numeric,boolean) from public, anon;
revoke all on function public.record_parts_catalog_cost(uuid,text,text,numeric,text,uuid) from public, anon;
grant execute on function public.save_parts_catalog_item(uuid,text,text,text,text,text,numeric,boolean) to authenticated;
grant execute on function public.record_parts_catalog_cost(uuid,text,text,numeric,text,uuid) to authenticated;

notify pgrst, 'reload schema';

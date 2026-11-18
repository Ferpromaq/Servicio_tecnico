-- Permite incorporar repuestos del catálogo de Ferpromaq a una orden.
-- No crea ni modifica existencias: solo vincula la solicitud con el catálogo.

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

  if p_order_id is null or not exists (
    select 1 from public.service_orders where id = p_order_id
  ) then
    raise exception 'La orden no existe';
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
      select name, active
      into v_catalog_name, v_catalog_active
      from public.parts_catalog
      where id = v_catalog_part_id;

      if not found or v_catalog_active is distinct from true then
        raise exception 'El repuesto seleccionado no existe o está inactivo en el catálogo';
      end if;

      -- La descripción queda vinculada al nombre vigente del catálogo.
      v_description := v_catalog_name;
      -- La marca de procedencia es informativa; no descuenta inventario.
      v_from_stock := true;
    end if;

    if v_description = '' or v_quantity is null or v_quantity <= 0
       or v_unit_price is null or v_unit_price < 0 then
      raise exception 'Revisa nombre, cantidad y valor de cada repuesto';
    end if;

    insert into public.parts_requests(
      order_id, description, quantity, unit_price, from_stock,
      catalog_part_id, created_by
    )
    values (
      p_order_id, v_description, v_quantity, v_unit_price, v_from_stock,
      v_catalog_part_id, auth.uid()
    )
    returning id into v_part_id;

    insert into public.order_events(
      order_id, event_type, description, actor_id, metadata
    )
    values (
      p_order_id,
      'repuesto',
      'Repuesto solicitado: ' || v_description,
      auth.uid(),
      jsonb_build_object(
        'part_id', v_part_id,
        'catalog_part_id', v_catalog_part_id,
        'quantity', v_quantity,
        'unit_price', v_unit_price,
        'from_stock', v_from_stock
      )
    );
  end loop;
end;
$$;

revoke all on function public.request_order_parts(uuid,jsonb) from public, anon;
grant execute on function public.request_order_parts(uuid,jsonb) to authenticated;

notify pgrst, 'reload schema';

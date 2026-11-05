-- Alta transaccional de órdenes: cliente, equipo y orden se crean en una sola operación.
create or replace function public.create_service_order(
  p_client_id uuid,
  p_client_name text,
  p_client_rut text,
  p_client_email text,
  p_client_phone text,
  p_client_address text,
  p_equipment_type text,
  p_brand text,
  p_model text,
  p_serial_number text,
  p_problem_description text,
  p_priority text default 'normal',
  p_assigned_technician uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
  v_client_id uuid;
  v_machine_id uuid;
  v_order_id uuid;
begin
  select role into v_role from public.profiles where id=auth.uid() and active=true;
  if v_role not in ('admin','supervisor') then raise exception 'Solo administración o supervisión puede crear órdenes'; end if;
  if nullif(trim(coalesce(p_problem_description,'')),'') is null then raise exception 'Describe el problema informado por el cliente'; end if;
  if nullif(trim(coalesce(p_equipment_type,'')),'') is null then raise exception 'Indica el tipo de equipo'; end if;
  if p_priority not in ('baja','normal','alta','urgente') then raise exception 'Prioridad no válida'; end if;

  if p_client_id is not null then
    select id into v_client_id from public.clients where id=p_client_id;
    if v_client_id is null then raise exception 'El cliente seleccionado no existe'; end if;
  else
    if nullif(trim(coalesce(p_client_name,'')),'') is null then raise exception 'Indica el nombre del cliente'; end if;
    if nullif(trim(coalesce(p_client_rut,'')),'') is not null then
      insert into public.clients(name,rut,email,phone,address)
      values(trim(p_client_name),trim(p_client_rut),nullif(trim(coalesce(p_client_email,'')),''),nullif(trim(coalesce(p_client_phone,'')),''),nullif(trim(coalesce(p_client_address,'')),''))
      on conflict (rut) where rut is not null and rut <> ''
      do update set name=excluded.name,email=coalesce(excluded.email,clients.email),phone=coalesce(excluded.phone,clients.phone),address=coalesce(excluded.address,clients.address),updated_at=now()
      returning id into v_client_id;
    else
      insert into public.clients(name,email,phone,address)
      values(trim(p_client_name),nullif(trim(coalesce(p_client_email,'')),''),nullif(trim(coalesce(p_client_phone,'')),''),nullif(trim(coalesce(p_client_address,'')),''))
      returning id into v_client_id;
    end if;
  end if;

  insert into public.machines(client_id,equipment_type,brand,model,serial_number)
  values(v_client_id,trim(p_equipment_type),nullif(trim(coalesce(p_brand,'')),''),nullif(trim(coalesce(p_model,'')),''),nullif(trim(coalesce(p_serial_number,'')),''))
  returning id into v_machine_id;

  insert into public.service_orders(client_id,machine_id,problem_description,priority,assigned_technician,created_by)
  values(v_client_id,v_machine_id,trim(p_problem_description),p_priority,p_assigned_technician,auth.uid())
  returning id into v_order_id;

  insert into public.order_events(order_id,event_type,description,actor_id)
  values(v_order_id,'creacion','Orden de servicio creada',auth.uid());
  return v_order_id;
end;
$$;

revoke all on function public.create_service_order(uuid,text,text,text,text,text,text,text,text,text,text,text,uuid) from public;
grant execute on function public.create_service_order(uuid,text,text,text,text,text,text,text,text,text,text,text,uuid) to authenticated;

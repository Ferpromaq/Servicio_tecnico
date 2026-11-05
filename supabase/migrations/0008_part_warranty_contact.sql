create or replace function public.update_part_coverage(
  p_part_id uuid,
  p_warranty_covered boolean,
  p_client_contacted boolean
) returns void
language plpgsql security definer set search_path=public as $$
declare v_role public.app_role; v_order_id uuid; v_description text;
begin
  select role into v_role from public.profiles where id=auth.uid() and active=true;
  if v_role not in ('admin','supervisor') then raise exception 'Solo administración o supervisión puede modificar la cobertura del repuesto'; end if;
  update public.parts_requests
     set warranty_covered=coalesce(p_warranty_covered,false),
         client_contacted=coalesce(p_client_contacted,false)
   where id=p_part_id
   returning order_id,description into v_order_id,v_description;
  if not found then raise exception 'El repuesto no existe'; end if;
  insert into public.order_events(order_id,event_type,description,actor_id,metadata)
  values(v_order_id,'garantia_repuesto','Cobertura y contacto actualizados para: '||v_description,auth.uid(),
    jsonb_build_object('part_id',p_part_id,'warranty_covered',p_warranty_covered,'client_contacted',p_client_contacted));
end;
$$;
revoke all on function public.update_part_coverage(uuid,boolean,boolean) from public;
grant execute on function public.update_part_coverage(uuid,boolean,boolean) to authenticated;

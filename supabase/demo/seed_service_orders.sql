-- DATOS DEMO FERPRO MAQ. Ejecutar una sola vez en Supabase SQL Editor.
-- Se insertan órdenes reales en la base de datos con demo_batch_id fijo.
-- No se emiten boletas/facturas tributarias: los folios son referencias ficticias.
do $$
declare
  v_batch uuid := 'd3a00000-0000-4000-8000-000000000025';
  v_client uuid; v_machine uuid; v_order uuid; v_part uuid;
  v_idx integer := 0;
  v_paid numeric;
  r record;
begin
  if exists(select 1 from public.service_orders where demo_batch_id=v_batch) then
    raise notice 'El lote demo ya existe. No se duplicaron órdenes.';
    return;
  end if;
  for r in
    select * from (values
      ('DEMO 01 - Sin garantía - boleta','Cliente Demo 01','Generador','Honda','EU22i','DEMO-SER-001',false,false,'boleta','DEMO-B001',25000,25000,'diagnostico',25000),
      ('DEMO 02 - Sin garantía - factura','Cliente Demo 02','Motosierra','Stihl','MS 250','DEMO-SER-002',false,false,'factura','DEMO-F002',30000,12000,'diagnostico',12000),
      ('DEMO 03 - Sin garantía - boleta repuestos','Cliente Demo 03','Desbrozadora','Husqvarna','143R','DEMO-SER-003',false,false,'boleta','DEMO-B003',20000,20000,'diagnostico',20000),
      ('DEMO 04 - Sin garantía - factura completa','Cliente Demo 04','Motobomba','Koshin','SEV-50X','DEMO-SER-004',false,false,'factura','DEMO-F004',22000,22000,'diagnostico',22000),
      ('DEMO 05 - Garantía - diagnóstico marca','Cliente Demo 05','Generador','Honda','EG6500','DEMO-SER-005',true,false,'factura','DEMO-F005',35000,0,'diagnostico',0),
      ('DEMO 06 - Garantía - daño cliente','Cliente Demo 06','Motosierra','Stihl','MS 180','DEMO-SER-006',true,true,'factura','DEMO-F006',28000,0,'diagnostico',0),
      ('DEMO 07 - Puesta en Marcha equipo nuevo','Cliente Demo 07','Generador nuevo','Hyundai','HY7000','DEMO-SER-007',true,false,'factura','DEMO-F007',0,0,'abono',0)
    ) as t(problem,client_name,equipment,brand,model,serial,warranty,customer_damage,receipt_type,receipt_number,diagnosis_amount,paid_type_amount,payment_type,payment_amount)
  loop
    v_idx:=v_idx+1;
    insert into public.clients(name,rut,email,phone,address)
    values(r.client_name,null,'demo'||v_idx||'@ferpromaq.invalid','000000000','Registro de prueba')
    returning id into v_client;
    insert into public.machines(client_id,equipment_type,brand,model,serial_number)
    values(v_client,r.equipment,r.brand,r.model,r.serial) returning id into v_machine;
    insert into public.service_orders(client_id,machine_id,problem_description,priority,status,warranty_entry,
      warranty_covers_damage,receipt_type,receipt_number,receipt_date,diagnosis_amount,installation_amount,
      commissioning,demo_batch_id)
    values(v_client,v_machine,r.problem,'normal',
      case when v_idx=7 then 'recepcion'::public.order_status when v_idx in (3,4) then 'en_reparacion'::public.order_status else 'diagnostico'::public.order_status end,
      r.warranty,r.warranty and not r.customer_damage,r.receipt_type,r.receipt_number,current_date-30,
      r.diagnosis_amount,case when v_idx=4 then 15000 else 0 end,v_idx=7,v_batch)
    returning id into v_order;
    update public.service_orders set diagnosis_receipt_type=case when not r.warranty then r.receipt_type end,
      diagnosis_receipt_number=case when not r.warranty then r.receipt_number end,
      diagnosis_receipt_amount=case when not r.warranty then r.payment_amount else null end
    where id=v_order;
    insert into public.order_events(order_id,event_type,description,metadata)
    values(v_order,'demo','Orden de demostración creada',jsonb_build_object('demo_batch_id',v_batch,'scenario',r.problem));
    if r.payment_amount>0 then
      insert into public.payments(order_id,payment_type,amount,method,reference,receipt_received)
      values(v_order,r.payment_type::public.payment_type,r.payment_amount,
        case when v_idx%2=0 then 'Transferencia' else 'Débito' end,
        r.receipt_type||' DEMO '||r.receipt_number,true);
    end if;
    if v_idx in (3,4,6) then
      insert into public.parts_requests(order_id,description,quantity,unit_price,status,warranty_covered,client_contacted)
      values(v_order,'Repuesto demo - filtro / bujía',1,18000,'comprado',false,true)
      returning id into v_part;
      if v_idx=3 then
        insert into public.payments(order_id,payment_type,amount,method,reference,receipt_received)
        values(v_order,'repuestos',9000,'Transferencia','BOLETA DEMO REP-003',true);
        insert into public.payment_parts(payment_id,part_id,amount)
        select p.id,v_part,9000 from public.payments p where p.order_id=v_order and p.payment_type='repuestos';
      elsif v_idx=4 then
        insert into public.payments(order_id,payment_type,amount,method,reference,receipt_received)
        values(v_order,'repuestos',18000,'Débito','FACTURA DEMO REP-004',true);
        insert into public.payment_parts(payment_id,part_id,amount)
        select p.id,v_part,18000 from public.payments p where p.order_id=v_order and p.payment_type='repuestos';
        insert into public.payments(order_id,payment_type,amount,method,reference,receipt_received)
        values(v_order,'instalacion',15000,'Transferencia','FACTURA DEMO INST-004',true);
      end if;
    end if;
  end loop;
end $$;

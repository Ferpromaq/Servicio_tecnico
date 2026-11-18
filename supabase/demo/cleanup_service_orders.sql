-- Elimina únicamente el lote demo y sus dependencias.
-- No afecta órdenes, clientes o equipos reales.
begin;
delete from public.service_orders
where demo_batch_id = 'd3a00000-0000-4000-8000-000000000025';

-- Los equipos demo tienen seriales DEMO-SER-001..007.
delete from public.machines
where serial_number like 'DEMO-SER-%';

-- Los clientes demo usan correos del dominio reservado .invalid.
delete from public.clients
where email like 'demo%@ferpromaq.invalid';
commit;

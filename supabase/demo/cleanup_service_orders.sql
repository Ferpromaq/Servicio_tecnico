-- Elimina únicamente las órdenes del lote demo y sus dependencias en cascada.
-- No afecta órdenes reales ni otros lotes.
delete from public.service_orders
where demo_batch_id = 'd3a00000-0000-4000-8000-000000000025';

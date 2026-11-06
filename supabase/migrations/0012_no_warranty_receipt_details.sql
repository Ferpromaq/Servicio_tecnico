-- Datos del comprobante de ingreso para órdenes sin garantía.
-- El monto corresponde al importe efectivamente pagado y la fotografía queda
-- almacenada en el bucket privado order-documents; aquí se guarda su ruta.

alter table public.service_orders
  add column if not exists diagnosis_receipt_amount numeric(12,2),
  add column if not exists diagnosis_receipt_photo_path text;

alter table public.service_orders
  drop constraint if exists service_orders_diagnosis_receipt_amount_check;

alter table public.service_orders
  add constraint service_orders_diagnosis_receipt_amount_check
  check (diagnosis_receipt_amount is null or diagnosis_receipt_amount > 0);

comment on column public.service_orders.diagnosis_receipt_amount is
  'Monto efectivamente pagado que figura en la boleta o factura del ingreso sin garantía.';
comment on column public.service_orders.diagnosis_receipt_photo_path is
  'Ruta privada en Storage de la fotografía del comprobante de ingreso sin garantía.';

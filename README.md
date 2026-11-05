# Ferpromaq · Servicio técnico

Aplicación independiente para administrar el flujo de servicio técnico. Este repositorio se desarrolla desde cero y no modifica el proyecto anterior.

## Stack
- Next.js 16, React 19 y TypeScript
- Tailwind CSS 4
- Supabase Auth + PostgreSQL + Row Level Security
- Lucide React

## Puesta en marcha
1. Crea un proyecto Supabase.
2. Copia `.env.example` a `.env.local` y completa `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Ejecuta en orden los archivos SQL de `supabase/migrations` desde el SQL Editor de Supabase.
4. Crea usuarios desde Supabase Auth y crea su fila en `public.profiles` con rol `admin`, `supervisor` o `tecnico`.
5. Ejecuta `npm install`, `npm run dev` y abre `http://localhost:3000`.

## Funcionalidad implementada
- Inicio de sesión con Supabase Auth y protección de rutas.
- Panel que consulta órdenes reales desde `service_orders`, clientes, máquinas y técnico asignado.
- Filtros por estado, búsqueda y contadores derivados de datos reales.
- Vista rápida de información de la orden.
- Servicios tipados para consultar repuestos, pagos e historial.
- Funciones SQL transaccionales para registrar diagnósticos, solicitar repuestos, autorizar/rechazar repuestos y registrar recepción/instalación.
- Restricción de autorización de repuestos para que solo admin pueda aprobar o rechazar.

## Pendiente antes de producción
- Completar pantallas de detalle y formularios de órdenes, diagnóstico, repuestos y pagos.
- Implementar cálculos y validaciones de garantía, regla de abono del 60% y condiciones de entrega.
- Completar notificaciones por correo y plantillas.
- Revisar y probar RLS y funciones RPC con cuentas reales de los tres roles.
- Configurar y ejecutar pruebas, lint y compilación en un entorno con las variables de Supabase.

**No conectar a producción ni cargar datos reales hasta completar las pruebas de seguridad por rol.**

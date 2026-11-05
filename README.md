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
- Alta de órdenes con cliente existente o nuevo, equipo, prioridad y asignación de técnico, mediante una operación SQL transaccional.
- Filtros por estado, búsqueda y contadores derivados de datos reales.
- Vista rápida de información de la orden.
- Ficha de orden con pestañas de resumen, diagnóstico, repuestos, pagos e historial.
- Servicios tipados para consultar repuestos, pagos e historial.
- Registro de diagnóstico y solicitudes de repuestos desde la ficha.
- Autorización de repuestos exclusiva para administradores; recepción e instalación registrables por el equipo.
- Registro de pagos restringido a admin/supervisor, con control de saldo de diagnóstico y distribución de pagos entre repuestos autorizados.
- Cambio de estado restringido a admin/supervisor, con auditoría de entrega forzada y validación de diagnóstico, 60% de repuestos y costo de instalación antes de entregar.
- Gestión de garantía y costos; Puesta en Marcha obliga a registrar boleta/factura y fecha, y dispara un aviso por correo al técnico asignado.
- Solicitud de autorización de repuestos al cliente por correo Resend, con enlace aleatorio de un solo uso, vencimiento a 7 días, hash SHA-256 almacenado en Supabase y consumo atómico mediante RPC.
- Pipeline de GitHub Actions para ejecutar TypeScript y build.
- Funciones SQL transaccionales para registrar diagnósticos, solicitar repuestos, autorizar/rechazar repuestos, marcar cobertura de garantía y registrar recepción/instalación.
- Restricción de autorización de repuestos para que solo admin pueda aprobar o rechazar.

## Pendiente antes de producción
- Completar edición administrativa de órdenes y clientes.
- Implementar la autorización de repuestos por parte del cliente mediante correo y enlace seguro.
- Validar el flujo completo de pagos, garantía y entrega con casos reales.
- Completar plantillas y notificaciones al cliente para autorización de repuestos.
- Revisar y probar RLS y funciones RPC con cuentas reales de los tres roles.
- Configurar y ejecutar pruebas, lint y compilación en un entorno con las variables de Supabase.

**No conectar a producción ni cargar datos reales hasta completar las pruebas de seguridad por rol. Configura también `RESEND_API_KEY` y `FROM_EMAIL` para activar correos.**

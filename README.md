# Ferpromaq · Servicio técnico

Aplicación independiente creada desde cero para administrar el flujo de servicio técnico.

## Stack
- Next.js 16, React 19 y TypeScript
- Tailwind CSS 4
- Supabase Auth + PostgreSQL + Row Level Security

## Puesta en marcha
1. Crea un proyecto Supabase nuevo.
2. Copia `.env.example` a `.env.local` y completa URL y clave anon.
3. Ejecuta el SQL de `supabase/migrations/0001_initial_schema.sql` en el SQL Editor de Supabase.
4. Crea usuarios desde Supabase Auth y crea su fila correspondiente en `public.profiles` con rol `admin`, `supervisor` o `tecnico`.
5. Ejecuta `npm install` y `npm run dev`.

## Estado del desarrollo
La base de datos define perfiles, clientes, equipos, órdenes, repuestos, pagos, asignaciones y eventos, con RLS y una protección de autorización de repuestos. La pantalla principal y el panel de orden son la primera capa de interfaz. Aún falta conectar cada vista a las tablas, implementar los cálculos de garantía y pagos, y completar notificaciones por correo antes de usarla en operación real.

**No conectar este proyecto a producción hasta revisar y probar las políticas RLS con usuarios de cada rol.**
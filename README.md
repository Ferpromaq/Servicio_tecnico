# Ferpromaq · Servicio técnico

Aplicación independiente para gestión de órdenes de servicio técnico.

## Stack
- Next.js 16 · React 19 · TypeScript
- Tailwind CSS 4
- Supabase JS

## Desarrollo
```bash
npm install
cp .env.example .env.local
npm run dev
```

Completa las variables de Supabase antes de habilitar persistencia. Esta primera base incluye una interfaz funcional de navegación, búsqueda, filtros, creación local de órdenes y panel de detalle. **Todavía no conecta las tablas de producción ni replica reglas de negocio existentes**: se debe definir y validar el esquema nuevo antes de activar autenticación, RLS, pagos, correos y flujos de autorización.

-- Enlaces de autorización de repuestos para clientes.
-- Los tokens en texto plano solo viajan por correo; en la base se guarda SHA-256.
create table if not exists public.part_client_authorizations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  part_id uuid not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  decision text check (decision in ('autorizado','rechazado')),
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists part_client_authorizations_part_idx
  on public.part_client_authorizations(part_id, created_at desc);
create index if not exists part_client_authorizations_expiry_idx
  on public.part_client_authorizations(expires_at)
  where used_at is null;

alter table public.part_client_authorizations enable row level security;
-- Sin políticas para anon/authenticated: solo el service_role puede gestionar tokens.

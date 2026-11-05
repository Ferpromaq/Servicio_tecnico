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


-- Consumo atómico: impide reutilizar el enlace y evita decisiones simultáneas.
create or replace function public.consume_part_client_authorization(
  p_token_hash text,
  p_decision text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_authorization public.part_client_authorizations%rowtype;
  v_updated_id uuid;
begin
  if p_decision not in ('autorizado', 'rechazado') then
    raise exception 'Decisión inválida';
  end if;

  update public.part_client_authorizations
     set used_at = now(), decision = p_decision
   where token_hash = p_token_hash
     and used_at is null
     and expires_at > now()
  returning * into v_authorization;

  if not found then
    raise exception 'Enlace inválido, vencido o ya utilizado';
  end if;

  update public.parts_requests
     set status = p_decision
   where id = v_authorization.part_id
     and order_id = v_authorization.order_id
     and status = 'pendiente'
  returning id into v_updated_id;

  if v_updated_id is null then
    raise exception 'El repuesto ya no está pendiente de autorización';
  end if;
end;
$$;

revoke all on function public.consume_part_client_authorization(text, text) from public, anon, authenticated;
grant execute on function public.consume_part_client_authorization(text, text) to service_role;


-- La RPC usa service_role para procesar el enlace público; el trigger de seguridad
-- debe permitir esa operación interna, sin ampliar permisos a usuarios normales.
create or replace function public.guard_part_authorization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('autorizado','rechazado')
     and old.status is distinct from new.status
     and coalesce(auth.role(), '') <> 'service_role'
     and public.current_role() is distinct from 'admin'::public.app_role then
    raise exception 'Solo un administrador puede autorizar o rechazar repuestos';
  end if;
  return new;
end;
$$;

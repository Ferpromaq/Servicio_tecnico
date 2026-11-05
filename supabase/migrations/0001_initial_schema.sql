-- Esquema inicial independiente para Ferpromaq Servicio Técnico.
create extension if not exists pgcrypto;
create type public.app_role as enum ('admin','supervisor','tecnico');
create type public.order_status as enum ('recepcion','diagnostico','en_reparacion','listas','entregadas','rechazadas');
create type public.part_status as enum ('pendiente','autorizado','rechazado','comprado');
create type public.payment_type as enum ('abono','repuestos','diagnostico','instalacion');

create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 full_name text not null,
 role public.app_role not null default 'tecnico',
 active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.clients (
 id uuid primary key default gen_random_uuid(), name text not null, rut text, email text, phone text, address text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index clients_rut_unique on public.clients(rut) where rut is not null and rut <> '';
create table public.machines (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id), brand text, model text,
 equipment_type text not null, serial_number text, description text, created_at timestamptz not null default now()
);
create table public.service_orders (
 id uuid primary key default gen_random_uuid(), order_number bigint generated always as identity unique,
 client_id uuid not null references public.clients(id), machine_id uuid references public.machines(id),
 status public.order_status not null default 'recepcion', priority text not null default 'normal' check(priority in ('baja','normal','alta','urgente')),
 problem_description text not null, diagnosis text, repair_notes text, assigned_technician uuid references public.profiles(id),
 warranty_entry boolean not null default false, warranty_covers_damage boolean, warranty_reason text,
 receipt_type text, receipt_number text, receipt_date date, diagnosis_amount numeric(12,2) not null default 0 check(diagnosis_amount>=0),
 forced_delivery boolean not null default false, forced_delivery_reason text, forced_delivery_by uuid references public.profiles(id), forced_delivery_at timestamptz,
 received_at timestamptz not null default now(), delivered_at timestamptz, created_by uuid references public.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.parts_requests (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.service_orders(id) on delete cascade,
 description text not null, quantity numeric(10,2) not null default 1 check(quantity>0), unit_price numeric(12,2) not null default 0 check(unit_price>=0),
 status public.part_status not null default 'pendiente', warranty_covered boolean not null default false,
 client_contacted boolean not null default false, from_stock boolean not null default false,
 received_at timestamptz, received_by uuid references public.profiles(id), installed_at timestamptz, installed_by uuid references public.profiles(id),
 authorized_at timestamptz, authorized_by uuid references public.profiles(id), created_by uuid references public.profiles(id), created_at timestamptz not null default now()
);
create table public.payments (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.service_orders(id) on delete cascade,
 payment_type public.payment_type not null, amount numeric(12,2) not null check(amount>0), method text, reference text,
 receipt_received boolean not null default false, paid_at timestamptz not null default now(), registered_by uuid references public.profiles(id), created_at timestamptz not null default now()
);
create table public.payment_parts (
 payment_id uuid not null references public.payments(id) on delete cascade, part_id uuid not null references public.parts_requests(id) on delete cascade,
 amount numeric(12,2) not null check(amount>0), primary key(payment_id,part_id)
);
create table public.order_events (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.service_orders(id) on delete cascade,
 event_type text not null, description text not null, metadata jsonb not null default '{}', actor_id uuid references public.profiles(id), created_at timestamptz not null default now()
);

create or replace function public.current_role() returns public.app_role language sql stable security definer set search_path=public as $$
 select role from public.profiles where id=auth.uid() and active=true limit 1;
$$;
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path=public as $$
 select public.current_role() in ('admin','supervisor','tecnico');
$$;

alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.machines enable row level security;
alter table public.service_orders enable row level security;
alter table public.parts_requests enable row level security;
alter table public.payments enable row level security;
alter table public.payment_parts enable row level security;
alter table public.order_events enable row level security;

create policy "staff read profiles" on public.profiles for select to authenticated using (public.is_staff());
create policy "admin manage profiles" on public.profiles for all to authenticated using(public.current_role()='admin') with check(public.current_role()='admin');
create policy "staff manage clients" on public.clients for all to authenticated using(public.is_staff()) with check(public.is_staff());
create policy "staff manage machines" on public.machines for all to authenticated using(public.is_staff()) with check(public.is_staff());
create policy "staff read orders" on public.service_orders for select to authenticated using(public.is_staff());
create policy "admin supervisor create orders" on public.service_orders for insert to authenticated with check(public.current_role() in ('admin','supervisor'));
create policy "admin supervisor update orders" on public.service_orders for update to authenticated using(public.current_role() in ('admin','supervisor')) with check(public.current_role() in ('admin','supervisor'));
create policy "staff read parts" on public.parts_requests for select to authenticated using(public.is_staff());
create policy "staff request parts" on public.parts_requests for insert to authenticated with check(public.is_staff());
create policy "staff update parts" on public.parts_requests for update to authenticated using(public.current_role() in ('admin','supervisor','tecnico')) with check(public.current_role() in ('admin','supervisor','tecnico'));
create policy "staff read payments" on public.payments for select to authenticated using(public.is_staff());
create policy "authorized roles register payments" on public.payments for insert to authenticated with check(public.current_role() in ('admin','supervisor'));
create policy "staff read payment parts" on public.payment_parts for select to authenticated using(public.is_staff());
create policy "authorized roles link payment parts" on public.payment_parts for insert to authenticated with check(public.current_role() in ('admin','supervisor'));
create policy "staff read events" on public.order_events for select to authenticated using(public.is_staff());
create policy "staff add events" on public.order_events for insert to authenticated with check(public.is_staff());

create or replace function public.guard_part_authorization() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status in ('autorizado','rechazado') and old.status is distinct from new.status and public.current_role() not in ('admin') then
   raise exception 'Solo un administrador puede autorizar o rechazar repuestos';
 end if;
 return new;
end; $$;
create trigger parts_authorization_guard before update on public.parts_requests for each row execute function public.guard_part_authorization();

create or replace function public.log_order_status_change() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if old.status is distinct from new.status then
  insert into public.order_events(order_id,event_type,description,actor_id,metadata)
  values(new.id,'estado','Estado actualizado: '||old.status||' → '||new.status,auth.uid(),jsonb_build_object('from',old.status,'to',new.status));
 end if;
 new.updated_at=now(); return new;
end; $$;
create trigger order_status_event before update on public.service_orders for each row execute function public.log_order_status_change();

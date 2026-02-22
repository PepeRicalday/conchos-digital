-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ==========================================
-- 1. UTILITY FUNCTIONS
-- ==========================================

-- Function to check if a user belongs to a specific module or is an SRL Admin
create or replace function public.check_user_access(target_module_id uuid)
returns boolean as $$
declare
  user_role text;
  user_module uuid;
begin
  select role, module_id into user_role, user_module
  from public.profiles
  where id = auth.uid();

  -- SRL Admins and Operators can access everything
  if user_role in ('admin', 'operator') then
    return true;
  end if;

  -- Canaleros and Module Chiefs can only access their own module
  if user_role in ('canalero', 'module_chief') and user_module = target_module_id then
    return true;
  end if;

  return false;
end;
$$ language plpgsql security definer;

-- ==========================================
-- 2. CORE TABLES
-- ==========================================

-- PROFILES (Users)
create table public.profiles (
  id uuid references auth.users not null primary key,
  email text,
  role text check (role in ('admin', 'operator', 'canalero', 'module_chief')),
  module_id uuid, -- Will reference modules(id) after table creation
  full_name text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- MODULES (Módulos de Riego / ACUs)
create table public.modules (
  id uuid default uuid_generate_v4() primary key,
  name text not null, -- e.g. "Modulo 1"
  acu_name text, -- e.g. "Asociación de Usuarios..."
  short_code text unique, -- e.g. "MOD-01"
  authorized_vol numeric default 0, -- Total volume authorized for the cycle (Mm3)
  accumulated_vol numeric default 0, -- Consumed volume (computed or aggregated)
  logo_url text,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- DELIVERY POINTS (Puntos de Entrega: Tomas, Laterales, Cárcamos)
create table public.delivery_points (
  id uuid default uuid_generate_v4() primary key,
  module_id uuid references public.modules(id) not null,
  name text not null,
  type text check (type in ('toma', 'lateral', 'carcamo')),
  km numeric, -- Kilometer marker on the main canal
  capacity_max numeric not null, -- Maximum design capacity (m3/s)
  coordinates_x numeric, -- Longitude or schematic X
  coordinates_y numeric, -- Latitude or schematic Y
  zone text,
  section text,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- DAMS (Presas)
create table public.dams (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  code text unique not null, -- PLB, PFM
  capacity_max numeric not null, -- NAMO
  capacity_current numeric not null,
  level_current numeric not null,
  extraction_rate numeric default 0,
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- MEASUREMENTS (Aforos / Tomas)
create table public.measurements (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) default auth.uid(),
  location_id uuid references public.delivery_points(id), -- Specific to delivery points for now
  value_q numeric not null, -- Flow rate (m3/s)
  value_vol numeric, -- Volume (Mm3) - Calculated or entered
  timestamp timestamp with time zone default timezone('utc'::text, now()) not null,
  notes text,
  -- Metadata for audit
  captured_offline boolean default false
);

-- ==========================================
-- 3. CONSTRAINTS & TRIGGERS ("Hidro-Sincronía")
-- ==========================================

-- Trigger Function: Validate Flow Capacity
create or replace function public.validate_flow_capacity()
returns trigger as $$
declare
  max_cap numeric;
begin
  select capacity_max into max_cap
  from public.delivery_points
  where id = NEW.location_id;

  if NEW.value_q > max_cap then
    raise exception 'Violación de Hidráulica: El gasto ingresado (% m3/s) excede la capacidad de diseño (% m3/s) de la estructura.', NEW.value_q, max_cap;
  end if;

  return NEW;
end;
$$ language plpgsql;

-- Apply Trigger
create trigger check_flow_capacity_trigger
before insert or update on public.measurements
for each row execute procedure public.validate_flow_capacity();


-- ==========================================
-- 4. ROW LEVEL SECURITY (RLS)
-- ==========================================

alter table public.profiles enable row level security;
alter table public.modules enable row level security;
alter table public.delivery_points enable row level security;
alter table public.measurements enable row level security;

-- PROFILES Policies
create policy "Users can view their own profile"
  on public.profiles for select
  using ( auth.uid() = id );

create policy "Admins can view entire roster"
  on public.profiles for select
  using ( exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'operator')) );

-- MODULES Policies
create policy "Public/Global Read for Modules (Dashboard)"
  on public.modules for select
  using ( true ); -- Dashboard is usually public or low-security for aggregated views, but for strictness:
  -- using ( check_user_access(id) ); -- Uncomment for strict mode

-- DELIVERY POINTS Policies
create policy "Staff see all points, Canaleros see their module"
  on public.delivery_points for select
  using ( check_user_access(module_id) );

-- MEASUREMENTS Policies
create policy "Staff see all, Canaleros see their module"
  on public.measurements for select
  using (
    exists (
      select 1 from public.delivery_points dp
      where dp.id = measurements.location_id
      and check_user_access(dp.module_id)
    )
  );

create policy "Canaleros can insert measurements for their module"
  on public.measurements for insert
  with check (
    exists (
      select 1 from public.delivery_points dp
      where dp.id = location_id
      and check_user_access(dp.module_id)
    )
  );

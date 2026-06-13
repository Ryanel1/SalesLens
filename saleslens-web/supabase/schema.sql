-- SalesLens web database schema
-- Run this in Supabase SQL Editor for the SalesLens project.

create extension if not exists pgcrypto;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.uploads (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  source_file text not null,
  original_file_name text not null,
  imported_by uuid references auth.users(id) on delete set null,
  received_date date,
  sales_period_start date,
  sales_period_end date,
  row_count integer not null default 0,
  skipped_count integer not null default 0,
  total_sales numeric(14, 2) not null default 0,
  total_units integer not null default 0,
  file_storage_path text,
  status text not null default 'imported',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uploads_status_check check (status in ('imported', 'warning', 'duplicate', 'failed'))
);

create table if not exists public.sales_records (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  upload_id uuid references public.uploads(id) on delete set null,
  transaction_date date not null,
  received_date date,
  amount numeric(14, 2) not null default 0,
  units integer,
  source_file text not null,
  product_class text,
  master_style text,
  color text,
  size text,
  raw_style_identifier text,
  style_number text,
  color_code text,
  catalog_color_name text,
  art_code text,
  last_received date,
  current_retail numeric(14, 2),
  year_to_date_amount numeric(14, 2),
  year_to_date_units integer,
  inventory_units integer,
  inventory_retail_value numeric(14, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sales_records_customer_date_idx
  on public.sales_records(customer_id, transaction_date);

create index if not exists sales_records_customer_style_idx
  on public.sales_records(customer_id, style_number, art_code, color);

create index if not exists sales_records_upload_idx
  on public.sales_records(upload_id);

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  style_number text not null,
  art_code text not null,
  color text not null,
  product_url text,
  image_url text,
  storage_path text,
  is_manual_override boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(customer_id, style_number, art_code, color)
);

create table if not exists public.style_catalog_entries (
  id uuid primary key default gen_random_uuid(),
  brand_class text not null,
  style_number text not null,
  style_name text,
  fit_category text,
  source_catalog text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(brand_class, style_number)
);

create table if not exists public.report_snapshots (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  title text not null,
  customer_id uuid references public.customers(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  payload jsonb not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists report_snapshots_token_idx
  on public.report_snapshots(token);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
before update on public.customers
for each row execute function public.set_updated_at();

drop trigger if exists uploads_set_updated_at on public.uploads;
create trigger uploads_set_updated_at
before update on public.uploads
for each row execute function public.set_updated_at();

drop trigger if exists sales_records_set_updated_at on public.sales_records;
create trigger sales_records_set_updated_at
before update on public.sales_records
for each row execute function public.set_updated_at();

drop trigger if exists product_images_set_updated_at on public.product_images;
create trigger product_images_set_updated_at
before update on public.product_images
for each row execute function public.set_updated_at();

drop trigger if exists style_catalog_entries_set_updated_at on public.style_catalog_entries;
create trigger style_catalog_entries_set_updated_at
before update on public.style_catalog_entries
for each row execute function public.set_updated_at();

drop trigger if exists report_snapshots_set_updated_at on public.report_snapshots;
create trigger report_snapshots_set_updated_at
before update on public.report_snapshots
for each row execute function public.set_updated_at();

create or replace function public.get_report_snapshot(report_token text)
returns table (
  token text,
  title text,
  payload jsonb,
  created_at timestamptz,
  expires_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    report_snapshots.token,
    report_snapshots.title,
    report_snapshots.payload,
    report_snapshots.created_at,
    report_snapshots.expires_at
  from public.report_snapshots
  where report_snapshots.token = report_token
    and (report_snapshots.expires_at is null or report_snapshots.expires_at > now())
  limit 1;
$$;

grant execute on function public.get_report_snapshot(text) to anon, authenticated;

alter table public.customers enable row level security;
alter table public.uploads enable row level security;
alter table public.sales_records enable row level security;
alter table public.product_images enable row level security;
alter table public.style_catalog_entries enable row level security;
alter table public.report_snapshots enable row level security;

drop policy if exists "Authenticated users can read customers" on public.customers;
create policy "Authenticated users can read customers"
on public.customers for select
to authenticated
using (true);

drop policy if exists "Authenticated users can manage customers" on public.customers;
create policy "Authenticated users can manage customers"
on public.customers for all
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users can read uploads" on public.uploads;
create policy "Authenticated users can read uploads"
on public.uploads for select
to authenticated
using (true);

drop policy if exists "Authenticated users can manage uploads" on public.uploads;
create policy "Authenticated users can manage uploads"
on public.uploads for all
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users can read sales records" on public.sales_records;
create policy "Authenticated users can read sales records"
on public.sales_records for select
to authenticated
using (true);

drop policy if exists "Authenticated users can manage sales records" on public.sales_records;
create policy "Authenticated users can manage sales records"
on public.sales_records for all
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users can read product images" on public.product_images;
create policy "Authenticated users can read product images"
on public.product_images for select
to authenticated
using (true);

drop policy if exists "Authenticated users can manage product images" on public.product_images;
create policy "Authenticated users can manage product images"
on public.product_images for all
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users can read style catalog entries" on public.style_catalog_entries;
create policy "Authenticated users can read style catalog entries"
on public.style_catalog_entries for select
to authenticated
using (true);

drop policy if exists "Authenticated users can manage style catalog entries" on public.style_catalog_entries;
create policy "Authenticated users can manage style catalog entries"
on public.style_catalog_entries for all
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users can read report snapshots" on public.report_snapshots;
create policy "Authenticated users can read report snapshots"
on public.report_snapshots for select
to authenticated
using (created_by = auth.uid());

drop policy if exists "Authenticated users can create report snapshots" on public.report_snapshots;
create policy "Authenticated users can create report snapshots"
on public.report_snapshots for insert
to authenticated
with check (created_by = auth.uid());

drop policy if exists "Authenticated users can update report snapshots" on public.report_snapshots;
create policy "Authenticated users can update report snapshots"
on public.report_snapshots for update
to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

drop policy if exists "Authenticated users can delete report snapshots" on public.report_snapshots;
create policy "Authenticated users can delete report snapshots"
on public.report_snapshots for delete
to authenticated
using (created_by = auth.uid());

insert into public.customers (name, display_order)
values
  ('Volshop', 10),
  ('Rebel Rags', 20)
on conflict (name) do update
set display_order = excluded.display_order;

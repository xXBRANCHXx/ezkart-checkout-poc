-- LEGACY DESIGN — DO NOT APPLY.
-- Ezkart now uses Supabase for Auth only. Structured application data belongs
-- in Cloudflare D1 and file bodies belong in R2. The active migration is:
-- cloudflare/ezkart-api/migrations/0001_core.sql
-- This file remains only as a historical record of the earlier design.

create extension if not exists pgcrypto;

create table if not exists public.sellers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 2 and 120),
  plan text not null default 'standard' check (plan in ('standard', 'advanced')),
  status text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  domain text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.seller_memberships (
  seller_id uuid not null references public.sellers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'admin', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (seller_id, user_id)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  type text not null check (type in ('physical', 'digital', 'subscription')),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  title text not null check (char_length(title) between 2 and 160),
  description text not null default '',
  sku text,
  currency text not null default 'IDR' check (currency ~ '^[A-Z]{3}$'),
  price_amount bigint not null check (price_amount >= 0),
  stock_quantity integer,
  weight_grams integer,
  billing_interval text,
  billing_interval_count integer,
  digital_filename text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (seller_id, id),
  unique (seller_id, sku),
  check (
    (type = 'physical' and weight_grams > 0 and stock_quantity >= 0 and billing_interval is null and billing_interval_count is null)
    or (type = 'digital' and weight_grams is null and stock_quantity is null and billing_interval is null and billing_interval_count is null)
    or (type = 'subscription' and weight_grams is null and stock_quantity is null and billing_interval in ('day', 'week', 'month') and billing_interval_count > 0)
  )
);

create table if not exists public.product_media (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null,
  product_id uuid not null,
  storage_bucket text not null default 'product-media' check (storage_bucket = 'product-media'),
  storage_path text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  size_bytes integer not null check (size_bytes between 1 and 2097152),
  sort_order smallint not null check (sort_order between 1 and 9),
  alt_text text not null default '',
  created_at timestamptz not null default now(),
  unique (seller_id, product_id, sort_order),
  unique (storage_bucket, storage_path),
  foreign key (seller_id, product_id) references public.products(seller_id, id) on delete cascade,
  check (storage_path like seller_id::text || '/' || product_id::text || '/%')
);

create table if not exists public.landing_pages (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  definition jsonb not null default '{}'::jsonb,
  published_version integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (seller_id, id),
  unique (seller_id, slug)
);

create table if not exists public.page_versions (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null,
  page_id uuid not null,
  version integer not null check (version > 0),
  definition jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (seller_id, page_id, version),
  foreign key (seller_id, page_id) references public.landing_pages(seller_id, id) on delete cascade
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  email text not null,
  name text not null default '',
  phone text not null default '',
  consent jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (seller_id, id),
  unique (seller_id, email)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete restrict,
  customer_id uuid,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled', 'refunded')),
  currency text not null default 'IDR' check (currency ~ '^[A-Z]{3}$'),
  subtotal_amount bigint not null check (subtotal_amount >= 0),
  shipping_amount bigint not null default 0 check (shipping_amount >= 0),
  total_amount bigint generated always as (subtotal_amount + shipping_amount) stored,
  customer_snapshot jsonb not null default '{}'::jsonb,
  shipping_address jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (seller_id, id),
  foreign key (seller_id, customer_id) references public.customers(seller_id, id) on delete restrict
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null,
  order_id uuid not null,
  product_id uuid,
  product_type text not null check (product_type in ('physical', 'digital', 'subscription')),
  title text not null,
  sku text,
  quantity integer not null check (quantity > 0),
  unit_price_amount bigint not null check (unit_price_amount >= 0),
  fulfillment_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (seller_id, id),
  foreign key (seller_id, order_id) references public.orders(seller_id, id) on delete cascade,
  foreign key (seller_id, product_id) references public.products(seller_id, id) on delete restrict
);

create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null,
  order_id uuid not null,
  provider text not null default 'midtrans' check (provider = 'midtrans'),
  provider_transaction_id text,
  provider_order_id text not null,
  status text not null,
  amount bigint not null check (amount >= 0),
  verified_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (seller_id, provider, provider_order_id),
  foreign key (seller_id, order_id) references public.orders(seller_id, id) on delete restrict
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null,
  customer_id uuid not null,
  product_id uuid not null,
  source_order_id uuid not null,
  provider text not null default 'midtrans' check (provider = 'midtrans'),
  provider_subscription_id text,
  status text not null default 'pending' check (status in ('pending', 'active', 'paused', 'cancelled', 'expired')),
  interval text not null check (interval in ('day', 'week', 'month')),
  interval_count integer not null check (interval_count > 0),
  next_charge_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (seller_id, id),
  foreign key (seller_id, customer_id) references public.customers(seller_id, id) on delete restrict,
  foreign key (seller_id, product_id) references public.products(seller_id, id) on delete restrict,
  foreign key (seller_id, source_order_id) references public.orders(seller_id, id) on delete restrict
);

create table if not exists public.entitlements (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null,
  customer_id uuid not null,
  product_id uuid not null,
  order_item_id uuid not null,
  storage_bucket text not null default 'digital-products' check (storage_bucket = 'digital-products'),
  storage_path text not null,
  status text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (seller_id, id),
  foreign key (seller_id, customer_id) references public.customers(seller_id, id) on delete restrict,
  foreign key (seller_id, product_id) references public.products(seller_id, id) on delete restrict,
  foreign key (seller_id, order_item_id) references public.order_items(seller_id, id) on delete restrict,
  check (storage_path like seller_id::text || '/' || product_id::text || '/%')
);

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null,
  order_id uuid not null,
  provider text not null default 'biteship' check (provider = 'biteship'),
  provider_order_id text,
  courier text not null,
  service text not null,
  status text not null default 'pending',
  tracking_number text,
  price_amount bigint not null check (price_amount >= 0),
  address_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (seller_id, id),
  foreign key (seller_id, order_id) references public.orders(seller_id, id) on delete restrict
);

create table if not exists public.seller_events (
  id bigint generated by default as identity primary key,
  seller_id uuid not null references public.sellers(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  entity_type text not null,
  entity_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.is_seller_member(target_seller_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.seller_memberships
    where seller_id = target_seller_id and user_id = auth.uid()
  );
$$;

revoke all on function public.is_seller_member(uuid) from public;
grant execute on function public.is_seller_member(uuid) to authenticated;

create or replace function public.seller_id_from_storage_path(object_name text)
returns uuid
language plpgsql
immutable
as $$
declare
  first_folder text;
begin
  first_folder := (storage.foldername(object_name))[1];
  if first_folder ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return first_folder::uuid;
  end if;
  return null;
end;
$$;

alter table public.sellers enable row level security;
alter table public.seller_memberships enable row level security;

drop policy if exists sellers_for_members on public.sellers;
create policy sellers_for_members on public.sellers
  for all to authenticated
  using (public.is_seller_member(id))
  with check (public.is_seller_member(id));

drop policy if exists memberships_for_user on public.seller_memberships;
create policy memberships_for_user on public.seller_memberships
  for select to authenticated
  using (user_id = auth.uid() or public.is_seller_member(seller_id));

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'products', 'product_media', 'landing_pages', 'page_versions', 'customers',
    'orders', 'order_items', 'payment_transactions', 'subscriptions',
    'entitlements', 'shipments', 'seller_events'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists seller_member_access on public.%I', table_name);
    execute format(
      'create policy seller_member_access on public.%I for all to authenticated using (public.is_seller_member(seller_id)) with check (public.is_seller_member(seller_id))',
      table_name
    );
  end loop;
end $$;

create or replace function public.check_active_product_media()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_seller uuid;
  target_product uuid;
  target_type text;
  target_status text;
  image_count integer;
  minimum_images integer;
begin
  if tg_table_name = 'products' then
    target_seller := new.seller_id;
    target_product := new.id;
  else
    target_seller := coalesce(new.seller_id, old.seller_id);
    target_product := coalesce(new.product_id, old.product_id);
  end if;

  select type, status into target_type, target_status
  from public.products
  where seller_id = target_seller and id = target_product;

  if target_status = 'active' then
    select count(*) into image_count
    from public.product_media
    where seller_id = target_seller and product_id = target_product;
    minimum_images := case when target_type = 'physical' then 3 else 1 end;
    if image_count < minimum_images then
      raise exception 'Active % product requires at least % image(s); found %', target_type, minimum_images, image_count;
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists active_product_has_images on public.products;
create constraint trigger active_product_has_images
after insert or update of status, type on public.products
deferrable initially deferred
for each row execute function public.check_active_product_media();

drop trigger if exists active_product_keeps_images on public.product_media;
create constraint trigger active_product_keeps_images
after insert or update or delete on public.product_media
deferrable initially deferred
for each row execute function public.check_active_product_media();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('product-media', 'product-media', true, 2097152, array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('page-assets', 'page-assets', true, 2097152, array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('digital-products', 'digital-products', false, null, null),
  ('seller-exports', 'seller-exports', false, null, null)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists seller_file_read on storage.objects;
create policy seller_file_read on storage.objects
for select to authenticated
using (
  bucket_id in ('product-media', 'page-assets', 'digital-products', 'seller-exports')
  and public.is_seller_member(public.seller_id_from_storage_path(name))
);

drop policy if exists seller_file_insert on storage.objects;
create policy seller_file_insert on storage.objects
for insert to authenticated
with check (
  bucket_id in ('product-media', 'page-assets', 'digital-products', 'seller-exports')
  and public.is_seller_member(public.seller_id_from_storage_path(name))
);

drop policy if exists seller_file_update on storage.objects;
create policy seller_file_update on storage.objects
for update to authenticated
using (public.is_seller_member(public.seller_id_from_storage_path(name)))
with check (public.is_seller_member(public.seller_id_from_storage_path(name)));

drop policy if exists seller_file_delete on storage.objects;
create policy seller_file_delete on storage.objects
for delete to authenticated
using (public.is_seller_member(public.seller_id_from_storage_path(name)));

create index if not exists products_seller_idx on public.products(seller_id, status);
create index if not exists pages_seller_idx on public.landing_pages(seller_id, status);
create index if not exists orders_seller_idx on public.orders(seller_id, created_at desc);
create index if not exists payments_order_idx on public.payment_transactions(seller_id, order_id);
create index if not exists subscriptions_due_idx on public.subscriptions(status, next_charge_at);
create index if not exists events_seller_idx on public.seller_events(seller_id, created_at desc);

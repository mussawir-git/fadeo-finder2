-- ============================================================
-- Fadeo Finder — Auth & Shop Approval Schema
-- Run this in Supabase Dashboard → SQL Editor → New query
-- ============================================================

create extension if not exists "pgcrypto"; -- gives us gen_random_uuid()

do $$ begin
  create type user_role as enum ('customer', 'owner', 'admin');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type shop_status as enum ('pending', 'approved', 'rejected');
exception
  when duplicate_object then null;
end $$;

-- ── Users ──────────────────────────────────────────────
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text not null unique,
  password_hash text not null,
  role          user_role not null default 'customer',
  created_at    timestamptz not null default now()
);

create index if not exists idx_users_email on users (lower(email));

-- ── Shops (one per owner, created at registration time) ─
create table if not exists shops (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references users(id) on delete cascade,
  shop_name      text not null,
  shop_username  text not null unique,   -- what the owner types into "Shop ID" at login
  location       text not null,
  status         shop_status not null default 'pending',
  created_at     timestamptz not null default now(),
  reviewed_at    timestamptz
);

create index if not exists idx_shops_owner on shops (owner_id);
create index if not exists idx_shops_status on shops (status);

-- ── Barbers (staff belonging to a shop) ─────────────────
do $$ begin
  create type barber_status as enum ('Available', 'Away');
exception
  when duplicate_object then null;
end $$;

create table if not exists barbers (
  id             text primary key,   -- client-generated id (e.g. "barber-1719999999999") so the
                                      -- frontend and backend always agree on the same identifier
  shop_id        uuid not null references shops(id) on delete cascade,
  name           text not null,
  role           text,
  specialty      text,
  photo          text,
  experience     integer,
  status         barber_status not null default 'Available',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_barbers_shop on barbers (shop_id);

-- ── Barber Attendance (one row per barber per calendar day) ─
do $$ begin
  create type attendance_status as enum ('present', 'leave', 'half-day');
exception
  when duplicate_object then null;
end $$;

create table if not exists barber_attendance (
  id             uuid primary key default gen_random_uuid(),
  barber_id      text not null references barbers(id) on delete cascade,
  shop_id        uuid not null references shops(id) on delete cascade,
  date           date not null default current_date,
  status         attendance_status not null default 'present',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (barber_id, date)
);

create index if not exists idx_attendance_shop_date on barber_attendance (shop_id, date);

-- ── Row Level Security ───────────────────────────────────
-- The backend talks to Supabase using the SERVICE ROLE key, which bypasses RLS
-- entirely. We still enable RLS with no public policies, so the anon/public
-- key (if ever exposed to a browser) can't read or write these tables directly.
alter table users enable row level security;
alter table shops enable row level security;
alter table barbers enable row level security;
alter table barber_attendance enable row level security;

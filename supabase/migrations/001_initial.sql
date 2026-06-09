create extension if not exists pgcrypto;

create table if not exists users (
  id text primary key,
  display_name text,
  email text,
  avatar_url text,
  created_at timestamptz default now()
);

create table if not exists graphs (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id),
  time_range text not null,
  graph_json jsonb not null,
  share_slug text unique,
  created_at timestamptz default now(),
  is_public boolean default false
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id),
  session_date date not null,
  artist_sequence text[] not null,
  created_at timestamptz default now()
);

create index if not exists graphs_user_time_range_idx
  on graphs (user_id, time_range, created_at desc);

create index if not exists sessions_user_date_idx
  on sessions (user_id, session_date desc);

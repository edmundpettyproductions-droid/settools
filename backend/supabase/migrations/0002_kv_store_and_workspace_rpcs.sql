-- Migration 0002: Flat KV store + workspace RPCs for sync MVP.
-- Strategy: mirror localStorage shape exactly (key/value) so existing code can
-- keep using localStorage as the local cache, and sync.js handles the mirror.
-- Per-row updated_at gives us last-write-wins.

create table kv_store (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  key          text not null,
  value        jsonb not null,
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, key)
);

alter table kv_store enable row level security;

create policy "members read/write own kv"
  on kv_store for all
  using      (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()))
  with check (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create trigger kv_store_updated before update on kv_store
  for each row execute function set_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- RPC: create_workspace(name) -> (id, join_code)
-- Any authenticated user (incl. anonymous) can create a workspace.
-- They become its owner + first member.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function create_workspace(p_name text)
returns table(workspace_id uuid, join_code text)
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_id   uuid;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  -- 6-char uppercase code, retry on collision (statistically rare)
  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from workspaces w where w.join_code = v_code);
  end loop;
  insert into workspaces (name, join_code, owner_id)
  values (coalesce(nullif(trim(p_name), ''), 'My Production'), v_code, auth.uid())
  returning id into v_id;
  insert into workspace_members (workspace_id, user_id, role)
  values (v_id, auth.uid(), 'owner');
  return query select v_id, v_code;
end
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- RPC: join_workspace(code) -> workspace_id
-- Lets a user join any workspace whose code they know.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function join_workspace(p_code text)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  p_code := upper(trim(p_code));
  select id into v_id from workspaces where join_code = p_code;
  if v_id is null then
    raise exception 'No workspace with that code';
  end if;
  insert into workspace_members (workspace_id, user_id, role)
  values (v_id, auth.uid(), 'member')
  on conflict do nothing;
  return v_id;
end
$$;

grant execute on function create_workspace(text) to authenticated;
grant execute on function join_workspace(text)   to authenticated;

-- Set Tools — initial schema
-- Maps the localStorage keys you have today onto Postgres tables.
-- Each "workspace" represents one production. Devices join with a short code.

-- ──────────────────────────────────────────────────────────────────────────
-- WORKSPACES (one per production)
-- ──────────────────────────────────────────────────────────────────────────
create table workspaces (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  join_code       text unique not null check (length(join_code) between 4 and 12),
  created_at      timestamptz not null default now(),
  owner_id        uuid references auth.users(id) on delete set null
);

-- ──────────────────────────────────────────────────────────────────────────
-- PROJECTS (the settools_pt.projects map)
-- ──────────────────────────────────────────────────────────────────────────
create table projects (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  name            text not null,
  episode         text,
  director        text,
  location        text,
  is_active       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index projects_workspace_idx on projects(workspace_id);

-- ──────────────────────────────────────────────────────────────────────────
-- SHOOTING DAYS
-- ──────────────────────────────────────────────────────────────────────────
create table shoot_days (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  day_num         integer not null,
  shoot_date      date,
  call_time       text,
  first_shot      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (project_id, day_num)
);
create index shoot_days_project_idx on shoot_days(project_id);

-- ──────────────────────────────────────────────────────────────────────────
-- CALL SHEETS / DOOD / SCENES / SCRIPTS — stored as JSONB blobs keyed by day
-- This mirrors your current shape (one big JSON per concern) but
-- gives you per-day rows so you can query history without parsing.
-- ──────────────────────────────────────────────────────────────────────────
create table day_artifacts (
  id              uuid primary key default gen_random_uuid(),
  day_id          uuid not null references shoot_days(id) on delete cascade,
  kind            text not null check (kind in ('call_sheet','dood','scenes','script','schedule','strip')),
  payload         jsonb not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (day_id, kind)
);
create index day_artifacts_day_idx on day_artifacts(day_id);

-- ──────────────────────────────────────────────────────────────────────────
-- CREW / CAST CONTACTS (the ST_nextday.contacts list)
-- ──────────────────────────────────────────────────────────────────────────
create table contacts (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  name            text not null,
  role            text,
  email           text,
  phone           text,
  emp_id          text,
  is_cast         boolean not null default false,
  created_at      timestamptz not null default now()
);
create index contacts_workspace_idx on contacts(workspace_id);

-- ──────────────────────────────────────────────────────────────────────────
-- SIGN-IN RECORDS (ST_signin) — append-only, audit trail
-- ──────────────────────────────────────────────────────────────────────────
create table sign_ins (
  id              uuid primary key default gen_random_uuid(),
  day_id          uuid not null references shoot_days(id) on delete cascade,
  contact_id      uuid references contacts(id) on delete set null,
  contact_name    text not null,  -- snapshot, survives if contact deleted
  signed_in_at    timestamptz not null default now(),
  signed_out_at   timestamptz,
  signature_png   text,           -- base64 data URL
  device_label    text            -- "kiosk-1", "kiosk-2", etc.
);
create index sign_ins_day_idx on sign_ins(day_id);

-- ──────────────────────────────────────────────────────────────────────────
-- ROW-LEVEL SECURITY — users can only see their own workspaces
-- ──────────────────────────────────────────────────────────────────────────
alter table workspaces      enable row level security;
alter table projects        enable row level security;
alter table shoot_days      enable row level security;
alter table day_artifacts   enable row level security;
alter table contacts        enable row level security;
alter table sign_ins        enable row level security;

-- Membership table: which users belong to which workspaces
create table workspace_members (
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null default 'member' check (role in ('owner','member','kiosk')),
  joined_at       timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
alter table workspace_members enable row level security;

create policy "members see own workspaces"
  on workspaces for select
  using (id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "members see own projects"
  on projects for all
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "members see own days"
  on shoot_days for all
  using (project_id in (
    select id from projects where workspace_id in (
      select workspace_id from workspace_members where user_id = auth.uid()
    )
  ));

create policy "members see own artifacts"
  on day_artifacts for all
  using (day_id in (
    select sd.id from shoot_days sd
    join projects p on p.id = sd.project_id
    where p.workspace_id in (
      select workspace_id from workspace_members where user_id = auth.uid()
    )
  ));

create policy "members see own contacts"
  on contacts for all
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "members see own signins"
  on sign_ins for all
  using (day_id in (
    select sd.id from shoot_days sd
    join projects p on p.id = sd.project_id
    where p.workspace_id in (
      select workspace_id from workspace_members where user_id = auth.uid()
    )
  ));

create policy "users see own membership"
  on workspace_members for select
  using (user_id = auth.uid());

-- ──────────────────────────────────────────────────────────────────────────
-- updated_at triggers
-- ──────────────────────────────────────────────────────────────────────────
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger projects_updated      before update on projects      for each row execute function set_updated_at();
create trigger shoot_days_updated    before update on shoot_days    for each row execute function set_updated_at();
create trigger day_artifacts_updated before update on day_artifacts for each row execute function set_updated_at();

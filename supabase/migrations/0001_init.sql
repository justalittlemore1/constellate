-- Constellate — initial schema. Owned by A0; later changes are NEW numbered files owned by A1.
-- Never edit this file after it has been applied.
--
-- Model: a NODE is one occurrence of a topic in one conversation; a CONCEPT is a topic across
-- conversations (the Brain). Every table carries user_id so one RLS rule covers everything.
-- The server writes with the service-role key but always sets user_id from the verified token.

create extension if not exists vector;

-- ── conversations and their contents ────────────────────────────────────────

create table folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  folder_id uuid references folders on delete set null,
  title text not null default 'Untitled conversation',
  summary text,
  macro_anchor text,
  status text not null default 'live' check (status in ('live', 'processing', 'ready', 'failed')),
  is_solo boolean not null default false,
  is_favorite boolean not null default false,
  location text,
  reflection text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_ms integer,
  audio_path text,
  last_seq integer not null default 0,
  brain_built_at timestamptz
);
create index conversations_user_started on conversations (user_id, started_at desc);

create table participants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  conversation_id uuid not null references conversations on delete cascade,
  display_name text not null,
  speaker_index smallint
);
create index participants_conversation on participants (conversation_id);
create index participants_user_name on participants (user_id, lower(display_name));

create table utterances (
  id text not null,
  user_id uuid not null references auth.users on delete cascade,
  conversation_id uuid not null references conversations on delete cascade,
  speaker smallint,
  start_ms integer not null,
  end_ms integer not null,
  text text not null,
  primary key (conversation_id, id)
);

create table nodes (
  id uuid primary key,
  user_id uuid not null references auth.users on delete cascade,
  conversation_id uuid not null references conversations on delete cascade,
  kind text not null check (kind in ('topic', 'pending', 'parked')),
  status text not null check (status in ('provisional', 'active', 'closed', 'unexplored', 'resolved')),
  level smallint not null check (level between 0 and 2),
  label text not null,
  summary text not null default '',
  details text,
  parent_id uuid references nodes on delete set null,
  thread_id uuid not null,
  seq integer not null,
  start_ms integer not null,
  end_ms integer,
  mentioned_at_ms integer,
  utterance_ids text[] not null default '{}',
  speakers smallint[] not null default '{}',
  highlighted boolean not null default false,
  created_by text not null default 'ai' check (created_by in ('ai', 'user')),
  x real not null,
  y real not null,
  concept_id uuid,
  embedding vector(768)
);
create index nodes_conversation_seq on nodes (conversation_id, seq);
create index nodes_embedding on nodes using hnsw (embedding vector_cosine_ops);

create table edges (
  id uuid primary key,
  user_id uuid not null references auth.users on delete cascade,
  conversation_id uuid not null references conversations on delete cascade,
  source_id uuid not null references nodes on delete cascade,
  target_id uuid not null references nodes on delete cascade,
  kind text not null check (kind in ('flow', 'revisit', 'tether', 'user'))
);
create index edges_conversation on edges (conversation_id);

create table flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  conversation_id uuid not null references conversations on delete cascade,
  at_ms integer not null,
  node_id uuid references nodes on delete set null,
  note text,
  source text not null check (source in ('button', 'key', 'media', 'tap'))
);
create index flags_conversation on flags (conversation_id);

create table commitments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  conversation_id uuid not null references conversations on delete cascade,
  node_id uuid references nodes on delete set null,
  text text not null,
  speaker smallint,
  at_ms integer not null,
  done boolean not null default false
);
create index commitments_conversation on commitments (conversation_id);

create table annotations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  conversation_id uuid not null references conversations on delete cascade,
  node_id uuid references nodes on delete set null,
  text text not null,
  x real not null,
  y real not null,
  updated_at timestamptz not null default now()
);
create index annotations_conversation on annotations (conversation_id);

create table highlights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  conversation_id uuid not null references conversations on delete cascade,
  name text,
  node_ids uuid[] not null,
  created_at timestamptz not null default now()
);

create table recall_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  conversation_id uuid not null references conversations on delete cascade,
  node_id uuid references nodes on delete cascade,
  prompt text not null,
  due_at timestamptz,
  last_result text
);

-- Append-only log of every OpBatch; nodes/edges/... are its materialised view.
create table op_log (
  conversation_id uuid not null references conversations on delete cascade,
  seq integer not null,
  user_id uuid not null references auth.users on delete cascade,
  source text not null check (source in ('live', 'finalize', 'user')),
  ops jsonb not null,
  created_at timestamptz not null default now(),
  primary key (conversation_id, seq)
);

-- ── the Brain ───────────────────────────────────────────────────────────────

create table concepts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  description text,
  parent_concept_id uuid references concepts on delete set null,
  mention_count integer not null default 0,
  embedding vector(768)
);
create index concepts_embedding on concepts using hnsw (embedding vector_cosine_ops);

create table concept_links (
  user_id uuid not null references auth.users on delete cascade,
  source_id uuid not null references concepts on delete cascade,
  target_id uuid not null references concepts on delete cascade,
  relation text not null check (relation in ('broader', 'related', 'co_discussed')),
  weight real not null,
  primary key (source_id, target_id, relation)
);

alter table nodes add constraint nodes_concept_fk foreign key (concept_id) references concepts on delete set null;

-- ── row level security: one rule for every table ────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'folders', 'conversations', 'participants', 'utterances', 'nodes', 'edges', 'flags',
    'commitments', 'annotations', 'highlights', 'recall_cards', 'op_log', 'concepts', 'concept_links'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy own_rows on %I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t
    );
  end loop;
end $$;

-- ── vector search RPCs (security invoker: RLS still applies to browser callers;
--    the server calls them with the service role and passes ids explicitly) ──

create or replace function match_nodes(
  p_conversation uuid,
  p_embedding vector(768),
  p_k integer default 3,
  p_exclude uuid default null
)
returns table (id uuid, label text, similarity real)
language sql stable security invoker
as $$
  select n.id, n.label, (1 - (n.embedding <=> p_embedding))::real as similarity
  from nodes n
  where n.conversation_id = p_conversation
    and n.kind = 'topic'
    and n.embedding is not null
    and (p_exclude is null or n.id <> p_exclude)
  order by n.embedding <=> p_embedding
  limit p_k;
$$;

create or replace function match_concepts(
  p_user uuid,
  p_embedding vector(768),
  p_k integer default 5
)
returns table (id uuid, name text, similarity real)
language sql stable security invoker
as $$
  select c.id, c.name, (1 - (c.embedding <=> p_embedding))::real as similarity
  from concepts c
  where c.user_id = p_user
    and c.embedding is not null
  order by c.embedding <=> p_embedding
  limit p_k;
$$;

-- ── storage: private recordings bucket, objects at {user_id}/{conversation_id}.webm ──

insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false)
on conflict (id) do nothing;

create policy recordings_select on storage.objects for select to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy recordings_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy recordings_update on storage.objects for update to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy recordings_delete on storage.objects for delete to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);

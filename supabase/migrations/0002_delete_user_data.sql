-- "Delete my data" in one transaction (A1: DELETE /me/data).
-- Removes everything the user owns in the public schema; the auth user itself stays.
-- Conversations cascade to participants, utterances, nodes (incl. embeddings), edges, flags,
-- commitments, annotations, highlights, recall_cards and op_log.
-- Recordings live in Storage and are removed by the server after this commits.

create or replace function delete_user_data(p_user uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  n_links integer;
  n_conversations integer;
  n_concepts integer;
  n_folders integer;
begin
  delete from concept_links where user_id = p_user;
  get diagnostics n_links = row_count;

  delete from conversations where user_id = p_user;
  get diagnostics n_conversations = row_count;

  delete from concepts where user_id = p_user;
  get diagnostics n_concepts = row_count;

  delete from folders where user_id = p_user;
  get diagnostics n_folders = row_count;

  return json_build_object(
    'conversations', n_conversations,
    'folders', n_folders,
    'concepts', n_concepts,
    'conceptLinks', n_links
  );
end;
$$;

-- only the server (service role) may call it; never browsers
revoke all on function delete_user_data(uuid) from public;
revoke all on function delete_user_data(uuid) from anon, authenticated;
grant execute on function delete_user_data(uuid) to service_role;

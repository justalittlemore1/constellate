import {
  fromRow,
  GraphStateSchema,
  RECORDINGS_BUCKET,
  TABLES,
  type Conversation,
  type GraphOp,
  type Utterance,
} from '@constellate/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Api,
  BrainPayload,
  ConceptSearchResult,
  FavoriteMoment,
  Folder,
  Participant,
  RebuildResult,
  RecallCard,
} from './types';

type Row = Record<string, unknown>;

export interface RealApiDeps {
  supabase: SupabaseClient;
  serverHttpUrl: string;
  userId: string;
  accessToken: string;
  fetch?: typeof fetch;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new ApiError(res.error.message, 0);
  return res.data;
}

const folderFromRow = (r: Row): Folder => ({
  id: String(r.id),
  name: String(r.name),
  createdAt: String(r.created_at ?? ''),
});
const participantFromRow = (r: Row): Participant => ({
  id: String(r.id),
  conversationId: String(r.conversation_id),
  displayName: String(r.display_name),
  speakerIndex: typeof r.speaker_index === 'number' ? r.speaker_index : null,
});
const recallFromRow = (r: Row): RecallCard => ({
  id: String(r.id),
  conversationId: String(r.conversation_id),
  nodeId: (r.node_id as string | null) ?? null,
  prompt: String(r.prompt),
  dueAt: (r.due_at as string | null) ?? null,
  lastResult: (r.last_result as string | null) ?? null,
});

/**
 * Lists and diary rows go straight to Supabase (RLS: `user_id = auth.uid()`); graphs, user ops,
 * deletion and the Brain go through the server, which owns every graph write.
 */
export function createRealApi({ supabase, serverHttpUrl, userId, accessToken, fetch: f = fetch }: RealApiDeps): Api {
  const base = serverHttpUrl.replace(/\/$/, '');

  async function server<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await f(`${base}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      try {
        const body = (await res.json()) as { message?: string };
        if (body.message) message = body.message;
      } catch {
        /* not JSON */
      }
      throw new ApiError(message, res.status);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  const postOps = (conversationId: string, ops: GraphOp[]) =>
    server(`/conversations/${conversationId}/ops`, { method: 'POST', body: JSON.stringify({ ops }) });

  async function conversationsById(ids: string[]): Promise<Map<string, Conversation>> {
    if (ids.length === 0) return new Map();
    const rows = check(await supabase.from(TABLES.conversations).select('*').in('id', ids)) as Row[];
    return new Map(rows.map((r) => [String(r.id), fromRow.conversation(r)]));
  }

  return {
    async listConversations() {
      const rows = check(
        await supabase.from(TABLES.conversations).select('*').order('started_at', { ascending: false }),
      ) as Row[];
      return rows.map(fromRow.conversation);
    },
    async updateConversation(id, patch) {
      // through the server so its in-memory graph and the op log stay the source of truth
      await postOps(id, [{ op: 'conversation.update', patch }]);
    },

    async listFolders() {
      const rows = check(await supabase.from(TABLES.folders).select('*').order('created_at')) as Row[];
      return rows.map(folderFromRow);
    },
    async createFolder(name) {
      const row = check(
        await supabase.from(TABLES.folders).insert({ name: name.trim(), user_id: userId }).select().single(),
      ) as Row;
      return folderFromRow(row);
    },
    async renameFolder(id, name) {
      check(await supabase.from(TABLES.folders).update({ name: name.trim() }).eq('id', id));
    },
    async deleteFolder(id) {
      check(await supabase.from(TABLES.folders).delete().eq('id', id));
    },

    async getGraph(id) {
      return GraphStateSchema.parse(await server(`/conversations/${id}`));
    },
    async listUtterances(id) {
      return (await server<{ utterances: Utterance[] }>(`/conversations/${id}/utterances`)).utterances;
    },

    async listParticipants(ids) {
      if (ids.length === 0) return [];
      const rows = check(await supabase.from(TABLES.participants).select('*').in('conversation_id', ids)) as Row[];
      return rows.map(participantFromRow);
    },
    async addParticipant(conversationId, displayName) {
      const row = check(
        await supabase
          .from(TABLES.participants)
          .insert({ conversation_id: conversationId, display_name: displayName.trim(), user_id: userId })
          .select()
          .single(),
      ) as Row;
      return participantFromRow(row);
    },
    async removeParticipant(id) {
      check(await supabase.from(TABLES.participants).delete().eq('id', id));
    },

    async updateCommitment(id, patch) {
      check(await supabase.from(TABLES.commitments).update(patch).eq('id', id));
    },

    async listRecallCards(conversationId) {
      const rows = check(
        await supabase.from(TABLES.recallCards).select('*').eq('conversation_id', conversationId),
      ) as Row[];
      return rows.map(recallFromRow);
    },
    async recordRecall(id, result) {
      check(await supabase.from(TABLES.recallCards).update({ last_result: result }).eq('id', id));
    },

    async listFavoriteMoments() {
      const [nodeRows, flagRows] = await Promise.all([
        supabase
          .from(TABLES.nodes)
          .select('id, conversation_id, label, summary, start_ms, seq')
          .eq('highlighted', true)
          .order('seq'),
        supabase.from(TABLES.flags).select('id, conversation_id, node_id, at_ms, note').order('at_ms'),
      ]);
      const nodes = check(nodeRows) as Row[];
      const flags = check(flagRows) as Row[];
      const flagNodeIds = flags.map((r) => r.node_id).filter((x): x is string => typeof x === 'string');
      const flagNodes = flagNodeIds.length
        ? (check(await supabase.from(TABLES.nodes).select('id, label, summary').in('id', flagNodeIds)) as Row[])
        : [];
      const nodeById = new Map(flagNodes.map((r) => [String(r.id), r]));
      const convs = await conversationsById([...new Set([...nodes, ...flags].map((r) => String(r.conversation_id)))]);
      const conv = (id: unknown) => convs.get(String(id));
      const out: FavoriteMoment[] = [];
      for (const r of nodes) {
        const c = conv(r.conversation_id);
        if (!c) continue;
        out.push({
          kind: 'highlight',
          id: String(r.id),
          conversationId: c.id,
          conversationTitle: c.title,
          audioPath: c.audioPath,
          nodeId: String(r.id),
          label: String(r.label),
          summary: String(r.summary ?? ''),
          atMs: Number(r.start_ms),
        });
      }
      for (const r of flags) {
        const c = conv(r.conversation_id);
        if (!c) continue;
        const n = typeof r.node_id === 'string' ? nodeById.get(r.node_id) : undefined;
        out.push({
          kind: 'flag',
          id: String(r.id),
          conversationId: c.id,
          conversationTitle: c.title,
          audioPath: c.audioPath,
          nodeId: (r.node_id as string | null) ?? null,
          label: n ? String(n.label) : 'Flagged moment',
          summary: String(r.note ?? n?.summary ?? ''),
          atMs: Number(r.at_ms),
        });
      }
      return out;
    },

    getBrain: () => server<BrainPayload>('/brain'),
    rebuildBrain: () => server<RebuildResult>('/brain/rebuild', { method: 'POST' }),
    async searchConcepts(query) {
      const q = query.trim();
      if (!q) return [];
      return (await server<{ results: ConceptSearchResult[] }>(`/brain/search?q=${encodeURIComponent(q)}`)).results;
    },

    async audioUrl(audioPath) {
      if (!audioPath) return null;
      const { data, error } = await supabase.storage.from(RECORDINGS_BUCKET).createSignedUrl(audioPath, 3600);
      return error ? null : data.signedUrl;
    },

    async deleteMyData() {
      // TODO(A1): replace with one atomic server route (e.g. DELETE /me/data) when it exists
      const rows = check(await supabase.from(TABLES.conversations).select('id')) as Row[];
      let conversationsDeleted = 0;
      for (const r of rows) {
        try {
          // the server route removes the recording and cascades every row (graph, transcript, embeddings)
          await server(`/conversations/${String(r.id)}`, { method: 'DELETE' });
          conversationsDeleted++;
        } catch {
          /* reported below; keep deleting the rest */
        }
      }
      const ok = async (p: PromiseLike<{ error: { message: string } | null }>) => {
        try {
          return !(await p).error;
        } catch {
          return false;
        }
      };
      const foldersDeleted = await ok(supabase.from(TABLES.folders).delete().eq('user_id', userId));
      const conceptsDeleted = await ok(supabase.from(TABLES.concepts).delete().eq('user_id', userId));
      return { conversationsTotal: rows.length, conversationsDeleted, foldersDeleted, conceptsDeleted };
    },

    capabilities: { editCommitments: false },
  };
}

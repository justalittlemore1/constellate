import { applyOps, type Conversation, type GraphState, type OpBatch } from '@constellate/shared';
import { loadDemoGraph } from '../fixtures';
import { mockBrainFromGraphs } from './mockBrain';
import type { Api, BrainPayload, DeletedCounts, FavoriteMoment, Folder, Participant, RecallCard } from './types';

let counter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;
const clone = <T>(v: T): T => structuredClone(v);

/**
 * In-memory API over the contract fixtures, for VITE_USE_MOCKS=1 and unit tests. Every call returns
 * copies so callers cannot mutate the store by accident. State lives until the page reloads.
 */
export function createMockApi(seed: GraphState[] = [loadDemoGraph()], extra: { recallCards?: RecallCard[] } = {}): Api {
  const graphs = new Map(seed.map((g) => [g.conversation.id, clone(g)]));
  let folders: Folder[] = [];
  let participants: Participant[] = [];
  let recall: RecallCard[] = clone(extra.recallCards ?? []);
  let brain: BrainPayload = { concepts: [], links: [], occurrences: {} };
  let built = false;

  function graph(id: string): GraphState {
    const g = graphs.get(id);
    if (!g) throw new Error('Conversation not found');
    return g;
  }

  const api: Api = {
    async listConversations() {
      return [...graphs.values()]
        .map((g) => clone(g.conversation))
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    },
    async updateConversation(id, patch) {
      const g = graph(id);
      g.conversation = { ...g.conversation, ...patch } as Conversation;
    },

    async listFolders() {
      return clone(folders);
    },
    async createFolder(name) {
      const f: Folder = { id: newId('folder'), name: name.trim(), createdAt: new Date().toISOString() };
      folders = [...folders, f];
      return clone(f);
    },
    async renameFolder(id, name) {
      folders = folders.map((f) => (f.id === id ? { ...f, name: name.trim() } : f));
    },
    async deleteFolder(id) {
      folders = folders.filter((f) => f.id !== id);
      for (const g of graphs.values()) if (g.conversation.folderId === id) g.conversation.folderId = null;
    },

    async getGraph(id) {
      return clone(graph(id));
    },
    async listUtterances() {
      return [];
    },

    async listParticipants(ids) {
      return clone(participants.filter((p) => ids.includes(p.conversationId)));
    },
    async addParticipant(conversationId, displayName) {
      const p: Participant = {
        id: newId('participant'),
        conversationId,
        displayName: displayName.trim(),
        speakerIndex: null,
      };
      participants = [...participants, p];
      return clone(p);
    },
    async removeParticipant(id) {
      participants = participants.filter((p) => p.id !== id);
    },

    async postOps(conversationId, ops) {
      // the same reducer and refusals as the server, so a refetch shows exactly what was saved
      const g = graph(conversationId);
      const batch: OpBatch = {
        conversationId,
        seq: g.lastSeq + 1,
        at: new Date().toISOString(),
        source: 'user',
        ops: clone(ops),
      };
      graphs.set(conversationId, applyOps(g, batch));
      return { batch: clone(batch) };
    },

    async listRecallCards(conversationId) {
      return clone(recall.filter((r) => r.conversationId === conversationId));
    },
    async recordRecall(id, result) {
      recall = recall.map((r) => (r.id === id ? { ...r, lastResult: result } : r));
    },

    async listFavoriteMoments() {
      const out: FavoriteMoment[] = [];
      for (const g of graphs.values()) {
        const c = g.conversation;
        const base = { conversationId: c.id, conversationTitle: c.title, audioPath: c.audioPath };
        for (const n of Object.values(g.nodes).sort((a, b) => a.seq - b.seq)) {
          if (n.highlighted)
            out.push({
              ...base,
              kind: 'highlight',
              id: n.id,
              nodeId: n.id,
              label: n.label,
              summary: n.summary,
              atMs: n.startMs,
              endMs: n.endMs,
            });
        }
        for (const f of g.flags) {
          const n = f.nodeId ? g.nodes[f.nodeId] : undefined;
          out.push({
            ...base,
            kind: 'flag',
            id: f.id,
            nodeId: f.nodeId,
            label: n?.label ?? 'Flagged moment',
            summary: f.note ?? n?.summary ?? '',
            atMs: f.atMs,
          });
        }
      }
      return out;
    },

    async getBrain() {
      return clone(brain);
    },
    async rebuildBrain() {
      const ready = [...graphs.values()].filter((g) => g.conversation.status === 'ready');
      const before = brain.concepts.length;
      brain = mockBrainFromGraphs(ready);
      const result = {
        conversations: built ? 0 : ready.length,
        newConcepts: brain.concepts.length - before,
        concepts: brain.concepts.length,
        links: brain.links.length,
      };
      built = true;
      return result;
    },
    async searchConcepts(query) {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      return brain.concepts
        .filter((c) => `${c.name} ${c.description ?? ''}`.toLowerCase().includes(q))
        .map((c) => ({ id: c.id, name: c.name, similarity: 1 }));
    },

    async audioUrl() {
      return null;
    },

    async deleteMyData() {
      const deleted: DeletedCounts = {
        conversations: graphs.size,
        folders: folders.length,
        concepts: brain.concepts.length,
        conceptLinks: brain.links.length,
        recordings: [...graphs.values()].filter((g) => g.conversation.audioPath).length,
      };
      graphs.clear();
      folders = [];
      participants = [];
      recall = [];
      brain = { concepts: [], links: [], occurrences: {} };
      built = false;
      return { outcome: 'deleted', deleted };
    },

    capabilities: { editCommitments: true },
  };
  return api;
}

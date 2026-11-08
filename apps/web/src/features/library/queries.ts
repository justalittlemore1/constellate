import type { Commitment, Conversation } from '@constellate/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi, type ConversationPatch, type Folder } from '../../lib/api';

export const keys = {
  conversations: ['conversations'] as const,
  folders: ['folders'] as const,
  graph: (id: string) => ['graph', id] as const,
  participants: (ids: string[]) => ['participants', ...[...ids].sort()] as const,
  recall: (id: string) => ['recall', id] as const,
  favorites: ['favorites'] as const,
};

export function useConversations() {
  const api = useApi();
  return useQuery({ queryKey: keys.conversations, queryFn: () => api.listConversations() });
}

export function useFolders() {
  const api = useApi();
  return useQuery({ queryKey: keys.folders, queryFn: () => api.listFolders() });
}

export function useGraph(id: string) {
  const api = useApi();
  return useQuery({ queryKey: keys.graph(id), queryFn: () => api.getGraph(id) });
}

export function useParticipants(conversationIds: string[]) {
  const api = useApi();
  return useQuery({
    queryKey: keys.participants(conversationIds),
    queryFn: () => api.listParticipants(conversationIds),
    enabled: conversationIds.length > 0,
  });
}

export function useRecallCards(conversationId: string) {
  const api = useApi();
  return useQuery({ queryKey: keys.recall(conversationId), queryFn: () => api.listRecallCards(conversationId) });
}

/** Optimistic conversation edit: the library list and the open graph update before the round trip. */
export function useUpdateConversation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ConversationPatch }) => api.updateConversation(id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: keys.conversations });
      const prev = qc.getQueryData<Conversation[]>(keys.conversations);
      qc.setQueryData<Conversation[]>(keys.conversations, (list) =>
        list?.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      );
      qc.setQueryData(keys.graph(id), (g: { conversation: Conversation } | undefined) =>
        g ? { ...g, conversation: { ...g.conversation, ...patch } } : g,
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.conversations, ctx.prev);
    },
    onSettled: (_d, _e, { id }) => {
      void qc.invalidateQueries({ queryKey: keys.conversations });
      void qc.invalidateQueries({ queryKey: keys.graph(id) });
    },
  });
}

export function useFolderMutations() {
  const api = useApi();
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.folders });
    void qc.invalidateQueries({ queryKey: keys.conversations });
  };
  const create = useMutation({
    mutationFn: (name: string) => api.createFolder(name),
    onSuccess: (f) => qc.setQueryData<Folder[]>(keys.folders, (list) => [...(list ?? []), f]),
    onSettled: refresh,
  });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.renameFolder(id, name),
    onSettled: refresh,
  });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteFolder(id), onSettled: refresh });
  return { create, rename, remove };
}

export function useParticipantMutations(conversationId: string) {
  const api = useApi();
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['participants'] });
  const add = useMutation({
    mutationFn: (name: string) => api.addParticipant(conversationId, name),
    onSettled: refresh,
  });
  const remove = useMutation({ mutationFn: (id: string) => api.removeParticipant(id), onSettled: refresh });
  return { add, remove };
}

export function useUpdateCommitment(conversationId: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<Commitment, 'text' | 'done'>> }) =>
      api.updateCommitment(id, patch),
    onMutate: ({ id, patch }) => {
      qc.setQueryData(keys.graph(conversationId), (g: { commitments: Commitment[] } | undefined) =>
        g ? { ...g, commitments: g.commitments.map((c) => (c.id === id ? { ...c, ...patch } : c)) } : g,
      );
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.graph(conversationId) }),
  });
}

export function useRecordRecall(conversationId: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, result }: { id: string; result: 'remembered' | 'forgot' }) => api.recordRecall(id, result),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.recall(conversationId) }),
  });
}

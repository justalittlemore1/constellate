import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../lib/api';

export const brainKeys = {
  brain: ['brain'] as const,
  search: (q: string) => ['brain-search', q] as const,
};

export function useBrain() {
  const api = useApi();
  return useQuery({ queryKey: brainKeys.brain, queryFn: () => api.getBrain() });
}

export function useRebuildBrain() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.rebuildBrain(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: brainKeys.brain }),
  });
}

export function useConceptSearch(query: string) {
  const api = useApi();
  const q = query.trim();
  return useQuery({
    queryKey: brainKeys.search(q),
    queryFn: () => api.searchConcepts(q),
    enabled: q.length > 0,
    staleTime: 5 * 60_000,
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

export function useDistributeItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => (await api.post('/distributions', payload)).data.distribution,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['distributions'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useDistributions(filters = {}) {
  return useQuery({
    queryKey: ['distributions', filters],
    queryFn: async () => (await api.get('/distributions', { params: filters })).data.distributions,
  });
}

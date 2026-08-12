import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

export function useCamps(params = {}) {
  return useQuery({
    queryKey: ['camps', params],
    queryFn: async () => (await api.get('/camps', { params })).data.camps,
  });
}

export function useCamp(id) {
  return useQuery({
    queryKey: ['camps', 'detail', id],
    queryFn: async () => (await api.get(`/camps/${id}`)).data.camp,
    enabled: Boolean(id),
  });
}

export function useCreateCamp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => (await api.post('/camps', payload)).data.camp,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['camps'] }),
  });
}

import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from './client.js';

export function useRaiseSos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => (await api.post('/sos', payload)).data.sos,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sos'] }),
  });
}

/** The reporter's own, at any camp. */
export function useMySos() {
  return useQuery({
    queryKey: ['sos', 'mine'],
    queryFn: async () => (await api.get('/sos/mine')).data.sos_requests,
  });
}

/** The Emergency dashboard, narrowed by the camp bar. */
export function useSosRequests(params = {}) {
  return useQuery({
    queryKey: ['sos', params],
    queryFn: async () => (await api.get('/sos', { params })).data.sos_requests,
    // Same reason as complaints: the camp scope settles just after mount,
    // changing this key. Without holding the previous page the list blanks
    // and re-fills on every camp switch.
    placeholderData: keepPreviousData,
  });
}

export function useTransitionSos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }) => (await api.patch(`/sos/${id}`, payload)).data.sos,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sos'] }),
  });
}

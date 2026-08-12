import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

export function useAreas() {
  return useQuery({ queryKey: ['areas'], queryFn: async () => (await api.get('/areas')).data.areas });
}

export function useActiveAlerts() {
  return useQuery({ queryKey: ['alerts', 'active'], queryFn: async () => (await api.get('/alerts/active')).data.alerts });
}

export function useCreateArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => (await api.post('/areas', payload)).data.area,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['areas'] }),
  });
}

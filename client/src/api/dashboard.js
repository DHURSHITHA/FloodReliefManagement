import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

export function useDashboardSummary() {
  return useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: async () => (await api.get('/dashboard/summary')).data,
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await api.get('/notifications')).data.notifications,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) => (await api.post(`/notifications/${id}/read`)).data.notification,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

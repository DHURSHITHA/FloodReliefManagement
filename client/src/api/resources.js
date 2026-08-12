import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

export function useResourceItems() {
  return useQuery({ queryKey: ['resources'], queryFn: async () => (await api.get('/resources')).data.items });
}

export function useCreateResourceItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => (await api.post('/resources', payload)).data.item,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['resources'] }),
  });
}

export function useInventory(campId) {
  return useQuery({
    queryKey: ['inventory', campId ?? 'all'],
    queryFn: async () => (await api.get('/inventory', { params: campId ? { camp_id: campId } : {} })).data.inventory,
  });
}

export function useCreateInventory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => (await api.post('/inventory', payload)).data.inventory,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory'] }),
  });
}

export function useAdjustInventory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }) => (await api.patch(`/inventory/${id}`, payload)).data.inventory,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory'] }),
  });
}

export function useDistributionRules(itemId) {
  return useQuery({
    queryKey: ['distribution-rules', itemId],
    queryFn: async () => (await api.get('/distribution-rules', { params: itemId ? { item_id: itemId } : {} })).data.rules,
    enabled: Boolean(itemId),
  });
}

export function useCreateDistributionRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => (await api.post('/distribution-rules', payload)).data.rule,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['distribution-rules'] }),
  });
}

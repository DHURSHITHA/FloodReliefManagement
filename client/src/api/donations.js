import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

export function useMyDonorProfile() {
  return useQuery({
    queryKey: ['donors', 'me'],
    queryFn: async () => (await api.get('/donors/me')).data.donor,
  });
}

export function useSaveDonorProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => (await api.post('/donors/me', payload)).data.donor,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['donors'] }),
  });
}

export function useRaiseDonation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => (await api.post('/donations', payload)).data.donation,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['donations'] }),
  });
}

/** The donor's own history. */
export function useMyDonations() {
  return useQuery({
    queryKey: ['donations', 'mine'],
    queryFn: async () => (await api.get('/donations/mine')).data.donations,
  });
}

/** The admin's review queue, optionally filtered. */
export function useAdminDonations(params = {}) {
  return useQuery({
    queryKey: ['donations', 'admin', params],
    queryFn: async () => (await api.get('/donations', { params })).data.donations,
  });
}

export function useDecideDonation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }) => (await api.patch(`/donations/${id}/confirm`, payload)).data.donation,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['donations'] }),
  });
}

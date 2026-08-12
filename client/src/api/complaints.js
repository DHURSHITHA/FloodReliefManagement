import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from './client.js';

export function useRaiseComplaint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => (await api.post('/complaints', payload)).data.complaint,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['complaints'] }),
  });
}

/** The reporter's own, at any camp. */
export function useMyComplaints() {
  return useQuery({
    queryKey: ['complaints', 'mine'],
    queryFn: async () => (await api.get('/complaints/mine')).data.complaints,
  });
}

/** An official's queue, narrowed by the camp bar. */
export function useComplaints(params = {}) {
  return useQuery({
    queryKey: ['complaints', params],
    queryFn: async () => (await api.get('/complaints', { params })).data.complaints,
    // The camp scope settles just after mount, changing this key. Without
    // holding the previous page the list blanks and re-fills on every camp
    // switch, which reads as "there is nothing here".
    placeholderData: keepPreviousData,
  });
}

export function useReviewComplaint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }) => (await api.patch(`/complaints/${id}`, payload)).data.complaint,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['complaints'] }),
  });
}

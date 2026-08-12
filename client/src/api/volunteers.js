import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

export function useActiveVolunteers(params = {}) {
  return useQuery({
    queryKey: ['volunteers', params],
    queryFn: async () => (await api.get('/volunteers', { params })).data.volunteers,
  });
}

export function useAssignVolunteerDuty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ memberId, task, shift }) =>
      (await api.post(`/volunteers/${memberId}/assign`, { task, shift })).data.member,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['volunteers'] }),
  });
}

export function useCompleteVolunteerDuty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ memberId, hours }) =>
      (await api.post(`/volunteers/${memberId}/complete`, { hours })).data.member,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['volunteers'] }),
  });
}

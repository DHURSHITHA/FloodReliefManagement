import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

export function useMyRegistration() {
  return useQuery({
    queryKey: ['registrations', 'me'],
    queryFn: async () => (await api.get('/registrations/me')).data.registration,
  });
}

export function useSubmitRegistration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ payload, idempotencyKey }) =>
      (await api.post('/registrations', payload, { headers: { 'Idempotency-Key': idempotencyKey } })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['registrations'] }),
  });
}

export function useSearchRegistrations(search) {
  return useQuery({
    queryKey: ['registrations', 'search', search],
    queryFn: async () => (await api.get('/registrations', { params: { search } })).data.registrations,
    enabled: Boolean(search),
  });
}

export function useCheckInMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ beneficiaryId, memberId }) =>
      (await api.post(`/registrations/${beneficiaryId}/members/${memberId}/checkin`)).data.member,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['registrations'] }),
  });
}

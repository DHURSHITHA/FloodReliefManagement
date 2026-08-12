import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
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

export function useSearchRegistrations(search, scopeParams = {}) {
  return useQuery({
    queryKey: ['registrations', 'search', search, scopeParams],
    queryFn: async () =>
      (await api.get('/registrations', { params: { search, ...scopeParams } })).data.registrations,
    enabled: Boolean(search),
    placeholderData: keepPreviousData,
  });
}

/** The distribution desk's queue for the selected camp, already in service order. */
export function usePriorityQueue(scopeParams = {}) {
  return useQuery({
    queryKey: ['registrations', 'priority', scopeParams],
    queryFn: async () => (await api.get('/registrations/priority', { params: scopeParams })).data.members,
    placeholderData: keepPreviousData,
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

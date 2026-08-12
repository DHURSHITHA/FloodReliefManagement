import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, setAccessToken } from './client.js';

export const meQueryKey = ['auth', 'me'];

export function useMe() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: async () => (await api.get('/auth/me')).data.user,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (credentials) => (await api.post('/auth/login', credentials)).data,
    onSuccess: (data) => {
      setAccessToken(data.access_token);
      qc.setQueryData(meQueryKey, data.user);
    },
  });
}

export function useSignup() {
  return useMutation({
    mutationFn: async (payload) => (await api.post('/auth/signup', payload)).data,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => { await api.post('/auth/logout'); },
    onSettled: () => { setAccessToken(null); qc.clear(); },
  });
}

/**
 * Restore a session on page load. The access token is gone (it lived in
 * memory), but the httpOnly refresh cookie survives, so one refresh call
 * silently signs the user back in.
 */
export async function restoreSession() {
  try {
    const { data } = await api.post('/auth/refresh');
    setAccessToken(data.access_token);
    return data.user;
  } catch {
    return null;
  }
}

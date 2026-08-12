import { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { restoreSession, meQueryKey, useLogout } from './api/auth.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const logoutMutation = useLogout();

  // `user` is read straight from the meQueryKey cache entry rather than a
  // separate useState. That entry is the single source of truth: the initial
  // fetch restores the session via the httpOnly refresh cookie, and
  // useLogin's onSuccess writes the freshly logged-in user into this same
  // cache slot — so a successful login is visible here immediately, without
  // AuthProvider needing to know login happened at all.
  const { data: user, isLoading } = useQuery({
    queryKey: meQueryKey,
    queryFn: async () => (await restoreSession()) ?? null,
    staleTime: Infinity,
    retry: false,
  });

  const value = {
    user: user ?? null,
    isLoading,
    logout: async () => { await logoutMutation.mutateAsync(); },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

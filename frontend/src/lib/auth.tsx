'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getToken, setToken } from './api';
import type { User } from './types';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  isAdmin: boolean;
  /** Signs in, or returns a challenge when the account uses two-factor authentication. */
  login: (email: string, password: string) => Promise<{ challenge: string } | null>;
  /** Second sign-in step: a 6-digit code or a backup code. */
  verifyTwoFactor: (challenge: string, code: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  /** Replace the cached user (after profile changes, verification, favorites…). */
  setUser: (user: User) => void;
  refreshUser: () => Promise<void>;
  /** Store a token + user returned by e.g. the reset-password endpoint. */
  signIn: (data: { token: string; user: User }) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const queryClient = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    if (!getToken()) {
      setStatus('anonymous');
      return;
    }
    api<{ user: User }>('/auth/me')
      .then(({ user }) => {
        setUser(user);
        setStatus('authenticated');
      })
      .catch(() => {
        setToken(null);
        setStatus('anonymous');
      });
  }, []);

  const handleAuth = useCallback(({ token, user }: { token: string; user: User }) => {
    setToken(token);
    setUser(user);
    setStatus('authenticated');
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api<{ token: string; user: User } | { twoFactorRequired: true; challenge: string }>('/auth/login', { method: 'POST', body: { email, password } });
      if ('twoFactorRequired' in res) return { challenge: res.challenge };
      handleAuth(res);
      return null;
    },
    [handleAuth],
  );

  const verifyTwoFactor = useCallback(
    async (challenge: string, code: string) => {
      handleAuth(await api('/auth/2fa/verify', { method: 'POST', body: { challenge, code } }));
    },
    [handleAuth],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      handleAuth(await api('/auth/register', { method: 'POST', body: { name, email, password } }));
    },
    [handleAuth],
  );

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setStatus('anonymous');
    queryClient.clear();
    router.replace('/login');
  }, [queryClient, router]);

  const refreshUser = useCallback(async () => {
    const { user: fresh } = await api<{ user: User }>('/auth/me');
    setUser(fresh);
  }, []);

  const value = useMemo(
    () => ({ user, status, isAdmin: user?.role === 'Admin', login, verifyTwoFactor, register, logout, setUser, refreshUser, signIn: handleAuth }),
    [user, status, login, verifyTwoFactor, register, logout, refreshUser, handleAuth],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

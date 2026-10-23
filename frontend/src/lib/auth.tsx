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
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
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
      handleAuth(await api('/auth/login', { method: 'POST', body: { email, password } }));
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

  const value = useMemo(
    () => ({ user, status, isAdmin: user?.role === 'Admin', login, register, logout }),
    [user, status, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

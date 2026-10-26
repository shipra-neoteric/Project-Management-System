'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthCard } from '@/components/layout/AuthCard';
import { Alert, PageLoader } from '@/components/ui/Feedback';
import { api, errorMessage, setToken } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { User } from '@/lib/types';

/** Lands here after single sign-on: the session token arrives in the URL fragment (never sent to a server). */
export default function SsoCallbackPage() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    // Remove the token from the address bar and history right away.
    window.history.replaceState(null, '', window.location.pathname);
    if (!token) {
      setError('The sign-in response was empty. Please try again.');
      return;
    }
    setToken(token);
    api<{ user: User }>('/auth/me')
      .then(({ user }) => {
        signIn({ token, user });
        router.replace('/dashboard');
      })
      .catch((err) => {
        setToken(null);
        setError(errorMessage(err, 'Could not complete single sign-on'));
      });
  }, [router, signIn]);

  return (
    <AuthCard
      title="Signing you in"
      subtitle="Completing single sign-on…"
      footer={
        <a href="/login" className="text-blue-600 dark:text-blue-400 font-medium hover:underline">
          Back to sign in
        </a>
      }
    >
      {error ? (
        <Alert>{error}</Alert>
      ) : (
        <PageLoader label="Just a moment…" />
      )}
    </AuthCard>
  );
}

'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AuthCard } from '@/components/layout/AuthCard';
import { Alert, PageLoader } from '@/components/ui/Feedback';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { User } from '@/lib/types';

export default function VerifyEmailPage() {
  const { user, setUser } = useAuth();
  const [state, setState] = useState<'working' | 'done' | 'error'>('working');
  const [message, setMessage] = useState('');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      setState('error');
      setMessage('This link is incomplete. Open the link from your email again.');
      return;
    }
    api<{ user: User }>('/auth/verify-email', { method: 'POST', body: { token } })
      .then(({ user: verified }) => {
        if (user && user._id === verified._id) setUser({ ...user, emailVerified: true });
        setState('done');
      })
      .catch((err) => {
        setState('error');
        setMessage(errorMessage(err));
      });
  }, [user, setUser]);

  return (
    <AuthCard
      title="Email confirmation"
      subtitle="Confirming your address lets us send you notifications."
      footer={
        <Link href={user ? '/dashboard' : '/login'} className="text-blue-600 dark:text-blue-400 font-medium hover:underline">
          {user ? 'Go to the dashboard' : 'Sign in'}
        </Link>
      }
    >
      {state === 'working' ? <PageLoader label="Confirming…" /> : state === 'done' ? <Alert tone="success">Thanks! Your email address is confirmed.</Alert> : <Alert>{message}</Alert>}
    </AuthCard>
  );
}

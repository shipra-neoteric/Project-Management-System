'use client';

import { KeyRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthCard } from '@/components/layout/AuthCard';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Feedback';
import { Field, inputCls } from '@/components/ui/Field';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { User } from '@/lib/types';

export default function ResetPasswordPage() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => setToken(new URLSearchParams(window.location.search).get('token') ?? ''), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError('Password must be at least 8 characters');
    if (password !== confirm) return setError('Passwords do not match');
    setLoading(true);
    try {
      signIn(await api<{ token: string; user: User }>('/auth/reset-password', { method: 'POST', body: { token, password } }));
      router.replace('/dashboard');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard
      title="Choose a new password"
      subtitle="You'll be signed in right away."
      footer={
        <Link href="/forgot-password" className="text-blue-600 dark:text-blue-400 font-medium hover:underline">
          Request a new link
        </Link>
      }
    >
      {!token ? (
        <Alert>This link is incomplete. Open the link from your email again.</Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}
          <Field label="New password" htmlFor="password" required>
            <input id="password" type="password" autoComplete="new-password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Confirm password" htmlFor="confirm" required>
            <input id="confirm" type="password" autoComplete="new-password" className={inputCls} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" icon={KeyRound} loading={loading} className="w-full">
            Save password
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

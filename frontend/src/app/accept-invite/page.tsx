'use client';

import { UserCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthCard } from '@/components/layout/AuthCard';
import { Button } from '@/components/ui/Button';
import { Alert, PageLoader } from '@/components/ui/Feedback';
import { Field, inputCls } from '@/components/ui/Field';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { User } from '@/lib/types';

export default function AcceptInvitePage() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ email: string; name: string } | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Read the token, then look up who the invitation is for.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token') ?? '';
    setToken(t);
    if (!t) return;
    api<{ email: string; name: string }>(`/auth/invite?token=${encodeURIComponent(t)}`)
      .then((data) => {
        setInvite(data);
        setName(data.name);
      })
      .catch((err) => setInvalid(errorMessage(err, 'This invitation link is invalid or has already been used')));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 2) return setError('Enter your name');
    if (password.length < 8) return setError('Password must be at least 8 characters');
    if (password !== confirm) return setError('Passwords do not match');
    setLoading(true);
    try {
      signIn(await api<{ token: string; user: User }>('/auth/accept-invite', { method: 'POST', body: { token, name: name.trim(), password } }));
      router.replace('/dashboard');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard
      title="Accept your invitation"
      subtitle="Choose a password to join your team."
      footer={
        <Link href="/login" className="text-blue-600 dark:text-blue-400 font-medium hover:underline">
          Already have an account? Sign in
        </Link>
      }
    >
      {token === null ? (
        <PageLoader />
      ) : !token ? (
        <Alert>This link is incomplete. Open the link from your email again.</Alert>
      ) : invalid ? (
        <Alert>{invalid}. Ask the person who invited you to send a new invitation.</Alert>
      ) : !invite ? (
        <PageLoader label="Checking your invitation…" />
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}
          <Field label="Email" htmlFor="email">
            <input id="email" type="email" className={inputCls} value={invite.email} disabled />
          </Field>
          <Field label="Your name" htmlFor="name" required>
            <input id="name" autoComplete="name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Field>
          <Field label="Password" htmlFor="password" required hint="At least 8 characters">
            <input id="password" type="password" autoComplete="new-password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Confirm password" htmlFor="confirm" required>
            <input id="confirm" type="password" autoComplete="new-password" className={inputCls} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" icon={UserCheck} loading={loading} className="w-full">
            Join and sign in
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

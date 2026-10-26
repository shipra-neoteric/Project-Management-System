'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, KeyRound, LogIn, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { AuthCard } from '@/components/layout/AuthCard';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Feedback';
import { Field, inputCls } from '@/components/ui/Field';
import { API_URL, api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';

const schema = z.object({
  email: z.string().trim().min(1, 'Email is required'),
  password: z.string().min(1, 'Password is required'),
});
type Values = z.infer<typeof schema>;

/** Only allow redirects to paths inside this app. */
function nextPath() {
  const next = new URLSearchParams(window.location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
}

export default function LoginPage() {
  const { login, verifyTwoFactor, status } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'warning' | 'success'; text: string } | null>(null);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [sso, setSso] = useState<{ enabled: boolean; label: string } | null>(null);
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema) });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('sso_error')) setError(params.get('sso_error'));
    else if (params.has('expired')) setNotice({ tone: 'warning', text: 'Your session expired. Please sign in again.' });
    else if (params.has('reset')) setNotice({ tone: 'success', text: 'Your password was changed. Sign in with it and your authenticator code.' });
    api<{ enabled: boolean; label: string }>('/auth/sso/config')
      .then(setSso)
      .catch(() => setSso(null));
  }, []);

  useEffect(() => {
    if (status === 'authenticated') router.replace(nextPath());
  }, [status, router]);

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const pending = await login(values.email, values.password);
      if (pending) {
        setChallenge(pending.challenge);
        setNotice(null);
        return;
      }
      router.replace(nextPath());
    } catch (err) {
      setError(errorMessage(err, 'Could not sign in'));
    }
  });

  if (challenge) {
    return (
      <TwoFactorStep
        onBack={() => {
          setChallenge(null);
          setError(null);
        }}
        onVerify={async (code) => {
          await verifyTwoFactor(challenge, code);
          router.replace(nextPath());
        }}
      />
    );
  }

  return (
    <AuthCard
      title="Sign in"
      subtitle="Welcome back. Sign in to your projects."
      footer={
        <>
          New here?{' '}
          <Link href="/register" className="text-blue-600 dark:text-blue-400 font-medium hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {notice && !error && <Alert tone={notice.tone}>{notice.text}</Alert>}
        {error && <Alert>{error}</Alert>}
        {sso?.enabled && (
          <>
            <a
              href={`${API_URL}/auth/sso/start`}
              className="w-full inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <KeyRound className="w-4 h-4" />
              Sign in with {sso.label}
            </a>
            <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
              <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
              or use your password
              <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
            </div>
          </>
        )}
        <Field label="Email" htmlFor="email" required error={formState.errors.email?.message}>
          <input id="email" type="email" autoComplete="email" className={cn(inputCls, formState.errors.email && 'border-red-400')} {...register('email')} />
        </Field>
        <div className="flex justify-end -mb-3">
          <Link href="/forgot-password" className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
            Forgot password?
          </Link>
        </div>
        <Field label="Password" htmlFor="password" required error={formState.errors.password?.message}>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            className={cn(inputCls, formState.errors.password && 'border-red-400')}
            {...register('password')}
          />
        </Field>
        <Button type="submit" variant="primary" icon={LogIn} loading={formState.isSubmitting} className="w-full">
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}

function TwoFactorStep({ onVerify, onBack }: { onVerify: (code: string) => Promise<void>; onBack: () => void }) {
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = useBackup ? /^[a-z0-9]{4}-?[a-z0-9]{4}$/i.test(code.trim()) : /^\d{6}$/.test(code.trim());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await onVerify(code.trim());
    } catch (err) {
      setError(errorMessage(err, 'That code did not work'));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title="Two-factor authentication"
      subtitle={useBackup ? 'Enter one of your backup codes. Each code works once.' : 'Enter the 6-digit code from your authenticator app.'}
      footer={
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 font-medium hover:underline">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
        </button>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label={useBackup ? 'Backup code' : 'Authentication code'} htmlFor="otp" required>
          <input
            id="otp"
            autoFocus
            autoComplete="one-time-code"
            inputMode={useBackup ? 'text' : 'numeric'}
            maxLength={useBackup ? 9 : 6}
            placeholder={useBackup ? 'xxxx-xxxx' : '123456'}
            className={cn(inputCls, 'tracking-[0.3em] text-center font-mono text-base')}
            value={code}
            onChange={(e) => setCode(useBackup ? e.target.value : e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        <Button type="submit" variant="primary" icon={ShieldCheck} loading={busy} disabled={!valid} className="w-full">
          Verify
        </Button>
        <button
          type="button"
          className="w-full text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          onClick={() => {
            setUseBackup((b) => !b);
            setCode('');
            setError(null);
          }}
        >
          {useBackup ? 'Use a code from my authenticator app' : 'Lost your phone? Use a backup code'}
        </button>
      </form>
    </AuthCard>
  );
}

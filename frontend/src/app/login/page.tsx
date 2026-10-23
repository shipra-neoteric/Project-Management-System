'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { LogIn } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { AuthCard } from '@/components/layout/AuthCard';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Feedback';
import { Field, inputCls } from '@/components/ui/Field';
import { errorMessage } from '@/lib/api';
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
  const { login, status } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema) });

  useEffect(() => {
    setExpired(new URLSearchParams(window.location.search).has('expired'));
  }, []);

  useEffect(() => {
    if (status === 'authenticated') router.replace(nextPath());
  }, [status, router]);

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await login(values.email, values.password);
      router.replace(nextPath());
    } catch (err) {
      setError(errorMessage(err, 'Could not sign in'));
    }
  });

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
        {expired && !error && <Alert tone="warning">Your session expired. Please sign in again.</Alert>}
        {error && <Alert>{error}</Alert>}
        <Field label="Email" htmlFor="email" required error={formState.errors.email?.message}>
          <input id="email" type="email" autoComplete="email" className={cn(inputCls, formState.errors.email && 'border-red-400')} {...register('email')} />
        </Field>
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

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { UserPlus } from 'lucide-react';
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

const schema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
    email: z.email('Enter a valid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters').max(128),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });
type Values = z.infer<typeof schema>;

export default function RegisterPage() {
  const { register: signUp, status } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema) });
  const errors = formState.errors;

  useEffect(() => {
    if (status === 'authenticated') router.replace('/dashboard');
  }, [status, router]);

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await signUp(values.name, values.email, values.password);
      router.replace('/dashboard');
    } catch (err) {
      setError(errorMessage(err, 'Could not create your account'));
    }
  });

  return (
    <AuthCard
      title="Create your account"
      subtitle="The first account becomes the administrator."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="text-blue-600 dark:text-blue-400 font-medium hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Full name" htmlFor="name" required error={errors.name?.message}>
          <input id="name" autoComplete="name" className={cn(inputCls, errors.name && 'border-red-400')} {...register('name')} />
        </Field>
        <Field label="Work email" htmlFor="email" required error={errors.email?.message}>
          <input id="email" type="email" autoComplete="email" className={cn(inputCls, errors.email && 'border-red-400')} {...register('email')} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <Field label="Password" htmlFor="password" required error={errors.password?.message}>
            <input id="password" type="password" autoComplete="new-password" className={cn(inputCls, errors.password && 'border-red-400')} {...register('password')} />
          </Field>
          <Field label="Confirm" htmlFor="confirm" required error={errors.confirm?.message}>
            <input id="confirm" type="password" autoComplete="new-password" className={cn(inputCls, errors.confirm && 'border-red-400')} {...register('confirm')} />
          </Field>
        </div>
        <Button type="submit" variant="primary" icon={UserPlus} loading={formState.isSubmitting} className="w-full">
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}

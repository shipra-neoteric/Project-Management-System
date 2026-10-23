'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { PageLoader } from '@/components/ui/Feedback';
import { toastError } from '@/lib/alerts';
import { useAuth } from '@/lib/auth';

/** Redirects non-admins to the dashboard (Nexora permission pattern). The API enforces this too. */
export function AdminGate({ children }: { children: ReactNode }) {
  const { user, isAdmin } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (user && !isAdmin) {
      router.replace('/dashboard');
      void toastError('Access denied: administrators only');
    }
  }, [user, isAdmin, router]);
  if (!isAdmin) return <PageLoader />;
  return <>{children}</>;
}

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { PageLoader } from '@/components/ui/Feedback';
import { toastError } from '@/lib/alerts';
import { useAuth } from '@/lib/auth';
import { hasGlobal } from '@/lib/permissions';
import type { GlobalPermission } from '@/lib/types';

/**
 * Redirects people without access to the dashboard (Nexora permission pattern). The API enforces this too.
 * Without `perm` only administrators get in; with it, anyone holding that organisation permission.
 */
export function AdminGate({ children, perm }: { children: ReactNode; perm?: GlobalPermission }) {
  const { user, isAdmin } = useAuth();
  const router = useRouter();
  const allowed = perm ? hasGlobal(user, perm) : isAdmin;
  useEffect(() => {
    if (user && !allowed) {
      router.replace('/dashboard');
      void toastError(perm ? 'Access denied: you don’t have permission for this page' : 'Access denied: administrators only');
    }
  }, [user, allowed, perm, router]);
  if (!allowed) return <PageLoader />;
  return <>{children}</>;
}

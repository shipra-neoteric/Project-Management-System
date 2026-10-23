'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { PageLoader } from '@/components/ui/Feedback';
import { useAuth } from '@/lib/auth';

export default function Home() {
  const { status } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (status !== 'loading') router.replace(status === 'authenticated' ? '/dashboard' : '/login');
  }, [status, router]);
  return <PageLoader />;
}

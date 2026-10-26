'use client';

import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useOrgSettings } from '@/features/queries';
import { useAuth } from '@/lib/auth';

/** Shown on every page while the organisation requires 2FA and the signed-in (password) user has not set it up. */
export function TwoFactorBanner() {
  const { user, status } = useAuth();
  const settings = useOrgSettings(status === 'authenticated');
  const pathname = usePathname();
  if (!user || !settings.data?.require2fa || user.twoFactorEnabled || user.sso) return null;
  return (
    <div className="mx-1 mt-1 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-2.5 flex items-center gap-3 text-sm text-amber-800 dark:text-amber-300" role="alert">
      <ShieldAlert className="w-4 h-4 shrink-0" />
      <span className="flex-1">Your organisation requires two-factor authentication. Set it up to keep your account secure.</span>
      {pathname !== '/profile' && (
        <Link href="/profile" className="font-medium underline whitespace-nowrap">
          Set up now
        </Link>
      )}
    </div>
  );
}

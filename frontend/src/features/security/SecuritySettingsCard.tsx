'use client';

import { useQuery } from '@tanstack/react-query';
import { KeyRound, ShieldCheck, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { IconButton } from '@/components/ui/Button';
import { PageLoader } from '@/components/ui/Feedback';
import { Card } from '@/components/ui/Layout';
import { useOrgSettings, useUpdateOrgSettings } from '@/features/queries';
import { confirmDanger, toastError, toastSuccess } from '@/lib/alerts';
import { api, errorMessage } from '@/lib/api';
import { fmtDate } from '@/lib/dates';
import { useTheme } from '@/lib/theme';
import { tokenExpired, useApiTokens } from './ApiTokensCard';

/** Organisation settings: require two-factor authentication, see single sign-on status and every API token. */
export function SecuritySettingsCard() {
  const { themeColor } = useTheme();
  const settings = useOrgSettings();
  const update = useUpdateOrgSettings();
  const sso = useQuery({ queryKey: ['sso-config'], queryFn: () => api<{ enabled: boolean; label: string }>('/auth/sso/config'), staleTime: 5 * 60_000 });
  const tokens = useApiTokens(true);
  const required = !!settings.data?.require2fa;

  const toggle = () =>
    update.mutate(
      { require2fa: !required },
      {
        onSuccess: () => void toastSuccess(!required ? 'Two-factor authentication is now required' : 'Two-factor authentication is now optional'),
        onError: (err) => void toastError(errorMessage(err)),
      },
    );

  const revoke = async (id: string, name: string, owner?: string) => {
    if (!(await confirmDanger(`Revoke “${name}”?`, `${owner ?? 'Its owner'} will need to create a new token.`, 'Revoke'))) return;
    tokens.revoke.mutate(id, { onSuccess: () => void toastSuccess('Token revoked'), onError: (err) => void toastError(errorMessage(err)) });
  };

  return (
    <Card title="Security" icon={ShieldCheck}>
      <div className="p-5 space-y-5">
        <label className="flex items-start gap-3 cursor-pointer">
          <button
            type="button"
            role="switch"
            aria-checked={required}
            onClick={toggle}
            disabled={update.isPending || settings.isLoading}
            className="mt-0.5 relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 bg-gray-300 dark:bg-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            style={required ? { backgroundColor: themeColor } : undefined}
          >
            <span className={`inline-block h-5 w-5 mt-0.5 rounded-full bg-white shadow transition-transform ${required ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
          <span>
            <span className="block text-sm font-medium text-gray-900 dark:text-white">Require two-factor authentication</span>
            <span className="block text-xs text-gray-500 dark:text-gray-400">
              Everyone who signs in with a password must set up an authenticator app. People using single sign-on are covered by your sign-in provider.
            </span>
          </span>
        </label>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">Single sign-on</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {sso.data?.enabled ? `People can sign in with ${sso.data.label}.` : 'Not set up. Configure an OpenID Connect provider on the server (see the deployment guide).'}
            </p>
          </div>
          <Badge tone={sso.data?.enabled ? 'success' : 'neutral'} dot>
            {sso.data?.enabled ? 'On' : 'Off'}
          </Badge>
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <KeyRound className="w-3.5 h-3.5" /> API tokens in use
          </p>
          {tokens.isLoading ? (
            <PageLoader />
          ) : !tokens.data?.length ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">Nobody has created an API token yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {tokens.data.map((t) => (
                <li key={t._id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-900 dark:text-white truncate">
                      {t.name} <span className="text-gray-500 dark:text-gray-400">· {t.user?.name ?? 'Former user'}</span>
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {t.scope === 'write' ? 'Read & write' : 'Read only'} · {t.lastUsedAt ? `used ${fmtDate(t.lastUsedAt.slice(0, 10))}` : 'never used'}
                      {tokenExpired(t) ? ' · expired' : ''}
                    </p>
                  </div>
                  <IconButton icon={Trash2} tone="delete" label={`Revoke ${t.name}`} onClick={() => void revoke(t._id, t.name, t.user?.name)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

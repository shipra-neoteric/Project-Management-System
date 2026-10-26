'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { Alert, EmptyState, PageLoader } from '@/components/ui/Feedback';
import { Field, inputCls } from '@/components/ui/Field';
import { Card } from '@/components/ui/Layout';
import { ThemedSelect } from '@/components/ui/ThemedSelect';
import { confirmDanger, toastError, toastSuccess } from '@/lib/alerts';
import { api, errorMessage } from '@/lib/api';
import { fmtDate } from '@/lib/dates';

export interface ApiTokenRow {
  _id: string;
  name: string;
  prefix: string;
  scope: 'read' | 'write';
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  user?: { _id: string; name: string; email: string } | null;
}

const KEY = (all: boolean) => ['api-tokens', all] as const;

export function useApiTokens(all = false) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: KEY(all), queryFn: async () => (await api<{ tokens: ApiTokenRow[] }>(`/tokens${all ? '?all=1' : ''}`)).tokens });
  const refresh = () => qc.invalidateQueries({ queryKey: ['api-tokens'] });
  return {
    ...query,
    create: useMutation({
      mutationFn: (body: { name: string; scope: 'read' | 'write'; expiresInDays: number | null }) => api<{ token: string; apiToken: ApiTokenRow }>('/tokens', { method: 'POST', body }),
      onSuccess: refresh,
    }),
    revoke: useMutation({ mutationFn: (id: string) => api<void>(`/tokens/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
  };
}

export const tokenExpired = (t: ApiTokenRow) => !!t.expiresAt && new Date(t.expiresAt) < new Date();

/** Profile card: personal access tokens for the public API. */
export function ApiTokensCard() {
  const tokens = useApiTokens();
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  const revoke = async (t: ApiTokenRow) => {
    if (!(await confirmDanger(`Revoke “${t.name}”?`, 'Scripts and integrations using it will stop working immediately.', 'Revoke'))) return;
    tokens.revoke.mutate(t._id, { onSuccess: () => void toastSuccess('Token revoked'), onError: (err) => void toastError(errorMessage(err)) });
  };

  return (
    <Card
      title="API tokens"
      icon={KeyRound}
      actions={
        <Button size="sm" icon={Plus} onClick={() => setOpen(true)}>
          New token
        </Button>
      }
    >
      <div className="p-5 space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Let scripts and other systems use the API as you. Read tokens can only view data.{' '}
          <Link href="/api-docs" className="text-blue-600 dark:text-blue-400 hover:underline">
            API documentation
          </Link>
        </p>
        {tokens.isLoading ? (
          <PageLoader />
        ) : !tokens.data?.length ? (
          <EmptyState compact icon={KeyRound} title="No API tokens" />
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700 -mx-1">
            {tokens.data.map((t) => (
              <li key={t._id} className="flex items-center gap-3 px-1 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate flex items-center gap-2">
                    {t.name}
                    <Badge tone={t.scope === 'write' ? 'warning' : 'info'}>{t.scope === 'write' ? 'Read & write' : 'Read only'}</Badge>
                    {tokenExpired(t) && <Badge tone="danger">Expired</Badge>}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">
                    {t.prefix}… · {t.lastUsedAt ? `used ${fmtDate(t.lastUsedAt.slice(0, 10))}` : 'never used'} · {t.expiresAt ? `expires ${fmtDate(t.expiresAt.slice(0, 10))}` : 'no expiry'}
                  </p>
                </div>
                <IconButton icon={Trash2} tone="delete" label={`Revoke ${t.name}`} onClick={() => void revoke(t)} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <CreateTokenDrawer
        open={open}
        onClose={() => setOpen(false)}
        onCreated={(token) => {
          setOpen(false);
          setCreated(token);
        }}
      />
      <Drawer
        open={!!created}
        onClose={() => setCreated(null)}
        title="Your new API token"
        subtitle="Copy it now — it will not be shown again"
        icon={KeyRound}
        width="md"
        footer={
          <>
            <Button inDrawer icon={Copy} onClick={() => void navigator.clipboard.writeText(created ?? '').then(() => toastSuccess('Token copied'))}>
              Copy
            </Button>
            <Button inDrawer variant="primary" onClick={() => setCreated(null)}>
              Done
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Alert tone="warning">Treat this like a password. Anyone with it can act as you through the API.</Alert>
          <textarea readOnly rows={3} className={`${inputCls} !h-auto font-mono text-xs break-all`} value={created ?? ''} aria-label="API token" onFocus={(e) => e.target.select()} />
          <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">curl -H &quot;Authorization: Bearer &lt;token&gt;&quot; {process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'}/projects</p>
        </div>
      </Drawer>
    </Card>
  );
}

function CreateTokenDrawer({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (token: string) => void }) {
  const { create } = useApiTokens();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'write'>('read');
  const [expiry, setExpiry] = useState('90');
  const submit = () =>
    create.mutate(
      { name: name.trim(), scope, expiresInDays: expiry ? Number(expiry) : null },
      {
        onSuccess: (data) => {
          setName('');
          onCreated(data.token);
        },
      },
    );
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New API token"
      subtitle="For scripts, reports and integrations"
      icon={KeyRound}
      width="md"
      footer={
        <>
          <Button inDrawer onClick={onClose}>
            Cancel
          </Button>
          <Button inDrawer variant="primary" icon={Plus} disabled={!name.trim()} loading={create.isPending} onClick={submit}>
            Create token
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {create.error && <Alert>{errorMessage(create.error)}</Alert>}
        <Field label="Name" htmlFor="tok-name" required hint="What will use it, e.g. “Power BI report”">
          <input id="tok-name" className={inputCls} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Access">
          <ThemedSelect
            value={scope}
            onChange={(v) => setScope(v as 'read' | 'write')}
            options={[
              { value: 'read', label: 'Read only', description: 'View projects, tasks, time and reports' },
              { value: 'write', label: 'Read & write', description: 'Also create and change data, as you' },
            ]}
          />
        </Field>
        <Field label="Expires">
          <ThemedSelect
            value={expiry}
            onChange={setExpiry}
            options={[
              { value: '30', label: 'In 30 days' },
              { value: '90', label: 'In 90 days' },
              { value: '365', label: 'In 1 year' },
              { value: '', label: 'Never' },
            ]}
          />
        </Field>
      </div>
    </Drawer>
  );
}

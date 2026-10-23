'use client';

import { BellRing, KeyRound, MailCheck, Save, UserCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, inputCls } from '@/components/ui/Field';
import { Card, Page, PageHeader } from '@/components/ui/Layout';
import { toastError, toastSuccess } from '@/lib/alerts';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { User } from '@/lib/types';

export default function ProfilePage() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => setName(user?.name ?? ''), [user?.name]);
  if (!user) return null;

  const run = async (key: string, fn: () => Promise<void>, success: string) => {
    setBusy(key);
    try {
      await fn();
      void toastSuccess(success);
    } catch (err) {
      void toastError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const updateProfile = (body: Record<string, unknown>, success: string, key: string) =>
    run(key, async () => setUser((await api<{ user: User }>('/auth/me', { method: 'PATCH', body })).user), success);

  return (
    <Page>
      <PageHeader title="My profile" subtitle="Your name, notifications and password" />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6">
        <Card title="Account" icon={UserCircle}>
          <div className="p-5 space-y-4">
            <Field label="Full name" htmlFor="pf-name" required>
              <input id="pf-name" className={inputCls} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Email">
              <div className="flex items-center gap-3">
                <input className={inputCls} value={user.email} disabled />
                {user.emailVerified ? <Badge tone="success">Confirmed</Badge> : <Badge tone="warning">Not confirmed</Badge>}
              </div>
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon={Save} disabled={name.trim().length < 2 || name.trim() === user.name} loading={busy === 'name'} onClick={() => updateProfile({ name: name.trim() }, 'Name updated', 'name')}>
                Save
              </Button>
              {!user.emailVerified && (
                <Button icon={MailCheck} loading={busy === 'verify'} onClick={() => run('verify', async () => void (await api('/auth/resend-verification', { method: 'POST' })), 'Confirmation email sent')}>
                  Resend confirmation email
                </Button>
              )}
            </div>
          </div>
        </Card>

        <Card title="Notifications" icon={BellRing}>
          <div className="p-5 space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              You always see notifications in the bell. Emails are sent when you are mentioned, assigned, or something changes on a task you watch.
            </p>
            <label className="flex items-center gap-3 text-sm text-gray-800 dark:text-gray-100">
              <input
                type="checkbox"
                className="w-4 h-4 accent-[var(--theme-primary)]"
                checked={user.notifyByEmail !== false}
                disabled={busy === 'notify'}
                onChange={(e) => updateProfile({ notifyByEmail: e.target.checked }, e.target.checked ? 'Email notifications on' : 'Email notifications off', 'notify')}
              />
              Send me notifications by email
            </label>
          </div>
        </Card>

        <Card title="Change password" icon={KeyRound}>
          <form
            className="p-5 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                'password',
                async () => {
                  await api('/auth/change-password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
                  setCurrent('');
                  setNext('');
                },
                'Password changed',
              );
            }}
          >
            <Field label="Current password" htmlFor="pf-current" required>
              <input id="pf-current" type="password" autoComplete="current-password" className={inputCls} value={current} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
            <Field label="New password" htmlFor="pf-new" required hint="At least 8 characters">
              <input id="pf-new" type="password" autoComplete="new-password" className={inputCls} value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
            <Button type="submit" variant="primary" icon={KeyRound} disabled={!current || next.length < 8} loading={busy === 'password'}>
              Change password
            </Button>
          </form>
        </Card>
      </div>
    </Page>
  );
}

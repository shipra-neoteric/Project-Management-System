'use client';

import { BellRing, CalendarOff, Clock, KeyRound, MailCheck, Plus, Save, Trash2, UserCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, inputCls } from '@/components/ui/Field';
import { Card, Page, PageHeader } from '@/components/ui/Layout';
import { useTimeOff } from '@/features/queries';
import { CalendarFeedCard } from '@/features/CalendarFeedCard';
import { RemindersCard } from '@/features/RemindersCard';
import { DEFAULT_SCHEDULE, WorkScheduleFields } from '@/features/WorkScheduleFields';
import { ApiTokensCard } from '@/features/security/ApiTokensCard';
import { TwoFactorCard } from '@/features/security/TwoFactorCard';
import { confirmDanger, toastError, toastSuccess } from '@/lib/alerts';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { diffDays, fmtDate, todayISO } from '@/lib/dates';
import type { User, WorkSchedule } from '@/lib/types';

export default function ProfilePage() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<WorkSchedule>(DEFAULT_SCHEDULE);

  useEffect(() => setName(user?.name ?? ''), [user?.name]);
  useEffect(() => setSchedule(user?.workSchedule ?? DEFAULT_SCHEDULE), [user?.workSchedule]);
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
      <PageHeader title="My profile" subtitle="Your name, working hours, time off, notifications and password" />
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

        <Card title="Working hours" icon={Clock}>
          <div className="p-5 space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">Used by the resource and team planners to show how much work you can take on.</p>
            <WorkScheduleFields value={schedule} onChange={setSchedule} idPrefix="pf-ws" />
            <Button
              variant="primary"
              icon={Save}
              loading={busy === 'schedule'}
              disabled={JSON.stringify(schedule) === JSON.stringify(user.workSchedule ?? DEFAULT_SCHEDULE)}
              onClick={() => updateProfile({ workSchedule: schedule }, 'Working hours saved', 'schedule')}
            >
              Save working hours
            </Button>
          </div>
        </Card>

        <TimeOffCard userId={user._id} />
        {/* [profile cards: import-scheduling] */}
        <RemindersCard />
        <CalendarFeedCard />
        {/* [profile cards: security-integrations] */}
        <TwoFactorCard />
        <ApiTokensCard />

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

function TimeOffCard({ userId }: { userId: string }) {
  const timeOff = useTimeOff(userId);
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState(todayISO());
  const [note, setNote] = useState('');
  const today = todayISO();
  const list = timeOff.data ?? [];

  const add = async () => {
    try {
      await timeOff.add.mutateAsync({ start, end, note: note.trim() });
      setNote('');
      void toastSuccess('Time off added');
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  return (
    <Card title="Time off" icon={CalendarOff}>
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_1.4fr_auto] gap-3 items-end">
          <Field label="From" htmlFor="to-start">
            <input id="to-start" type="date" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="To" htmlFor="to-end">
            <input id="to-end" type="date" className={inputCls} value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <Field label="Note" htmlFor="to-note" className="col-span-2 sm:col-span-1">
            <input id="to-note" className={inputCls} value={note} maxLength={200} placeholder="Holiday, training…" onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Button icon={Plus} loading={timeOff.add.isPending} disabled={!start || !end || end < start} onClick={add}>
            Add
          </Button>
        </div>
        {list.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">No time off planned.</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {list.map((t) => (
              <li key={t._id} className="flex items-center gap-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${t.end < today ? 'text-gray-400 dark:text-gray-500' : 'text-gray-800 dark:text-gray-100'}`}>
                    {fmtDate(t.start)}
                    {t.end !== t.start && ` → ${fmtDate(t.end)}`}
                    <span className="ml-2 text-xs font-normal text-gray-400 tabular-nums">
                      {diffDays(t.start, t.end) + 1} day{diffDays(t.start, t.end) === 0 ? '' : 's'}
                    </span>
                  </p>
                  {t.note && <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{t.note}</p>}
                </div>
                <IconButton
                  icon={Trash2}
                  label="Remove time off"
                  tone="delete"
                  onClick={async () => {
                    if (!(await confirmDanger('Remove this time off?', 'Planners will count these days as working days again.', 'Remove'))) return;
                    try {
                      await timeOff.remove.mutateAsync(t._id);
                      void toastSuccess('Time off removed');
                    } catch (err) {
                      void toastError(errorMessage(err));
                    }
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

'use client';

import { AlarmClock, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Card } from '@/components/ui/Layout';
import { ThemedSelect } from '@/components/ui/ThemedSelect';
import { toastError, toastSuccess } from '@/lib/alerts';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { ReminderPrefs, User } from '@/lib/types';

const DEFAULTS: ReminderPrefs = { dueSoonDays: 1, overdue: true, digest: false, assigned: true, accountable: true, watched: false };
const DAY_OPTIONS = [
  { value: '0', label: 'Off' },
  { value: '1', label: '1 day before' },
  { value: '2', label: '2 days before' },
  { value: '3', label: '3 days before' },
  { value: '5', label: '5 days before' },
  { value: '7', label: '1 week before' },
  { value: '14', label: '2 weeks before' },
];

/** Profile card: date reminders (due soon / overdue) and the daily email digest. */
export function RemindersCard() {
  const { user, isAdmin, setUser } = useAuth();
  const [prefs, setPrefs] = useState<ReminderPrefs>(user?.reminders ?? DEFAULTS);
  const [busy, setBusy] = useState<'save' | 'run' | null>(null);
  useEffect(() => {
    if (user?.reminders) setPrefs(user.reminders);
  }, [user?.reminders]);
  if (!user) return null;

  const set = (patch: Partial<ReminderPrefs>) => setPrefs((p) => ({ ...p, ...patch }));
  const dirty = JSON.stringify(prefs) !== JSON.stringify(user.reminders ?? DEFAULTS);

  const save = async () => {
    setBusy('save');
    try {
      const res = await api<{ user: User }>('/reminders/preferences', { method: 'PUT', body: prefs });
      setUser(res.user);
      void toastSuccess('Reminder settings saved');
    } catch (err) {
      void toastError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const runNow = async () => {
    setBusy('run');
    try {
      const s = await api<{ notifications: number; emails: number }>('/reminders/run', { method: 'POST' });
      void toastSuccess(`Reminders sent: ${s.notifications} notifications, ${s.emails} emails`);
    } catch (err) {
      void toastError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const check = (key: keyof ReminderPrefs, label: string, hint?: string) => (
    <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
      <input type="checkbox" className="mt-0.5 rounded" checked={!!prefs[key]} onChange={(e) => set({ [key]: e.target.checked })} />
      <span>
        {label}
        {hint && <span className="block text-xs text-gray-400 dark:text-gray-500">{hint}</span>}
      </span>
    </label>
  );

  return (
    <Card
      title="Reminders"
      icon={AlarmClock}
      actions={
        isAdmin && (
          <Button size="sm" variant="ghost" icon={Play} loading={busy === 'run'} onClick={runNow} title="Send due reminders for everyone now (they also go out every hour)">
            Run now
          </Button>
        )
      }
    >
      <div className="p-5 space-y-4">
        <Field label="Remind me before start and due dates">
          <ThemedSelect options={DAY_OPTIONS} value={String(prefs.dueSoonDays)} onChange={(v) => set({ dueSoonDays: Number(v) })} />
        </Field>
        {check('overdue', 'Tell me when a task is overdue')}
        {check('digest', 'Send me a daily email summary', user.email && user.notifyByEmail !== false ? 'One email a day listing overdue and upcoming tasks' : 'Needs an email address and email notifications switched on')}
        <div>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">For tasks where I am</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {check('assigned', 'Assignee')}
            {check('accountable', 'Accountable')}
            {check('watched', 'Watching')}
          </div>
        </div>
        <Button variant="primary" onClick={save} loading={busy === 'save'} disabled={!dirty}>
          Save reminders
        </Button>
      </div>
    </Card>
  );
}

'use client';

import { CalendarPlus, Pencil, Repeat } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { Alert } from '@/components/ui/Feedback';
import { Field, inputCls, Sec } from '@/components/ui/Field';
import { ThemedSelect } from '@/components/ui/ThemedSelect';
import { FREQUENCY_LABEL, fromLocalInputs, toLocalInputs, useMeetingMutations, type Meeting, type RecurrenceFrequency, type Scope } from '@/features/meetings';
import { toastSuccess } from '@/lib/alerts';
import { errorMessage } from '@/lib/api';
import { addDays, todayISO } from '@/lib/dates';
import type { UserRef } from '@/lib/types';

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240].map((m) => ({ value: String(m), label: m < 60 ? `${m} min` : `${m / 60} h${m % 60 ? ` ${m % 60} min` : ''}` }));
const REPEAT_OPTIONS = [{ value: '', label: 'Does not repeat' }, ...(Object.keys(FREQUENCY_LABEL) as RecurrenceFrequency[]).map((f) => ({ value: f, label: FREQUENCY_LABEL[f] }))];

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
  people: UserRef[];
  /** Edit this meeting's details; omit to schedule a new one. */
  meeting?: Meeting | null;
  /** Asked when editing a meeting that belongs to a series. */
  askScope?: () => Promise<Scope | null>;
  onCreated?: (id: string) => void;
}

/** Schedule a meeting (optionally recurring) or edit its title, time, place and participants. */
export function MeetingFormDrawer({ open, onClose, projectId, people, meeting, askScope, onCreated }: Props) {
  const { create, update } = useMeetingMutations(projectId);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState('10:00');
  const [duration, setDuration] = useState('60');
  const [location, setLocation] = useState('');
  const [participants, setParticipants] = useState<string[]>([]);
  const [frequency, setFrequency] = useState<RecurrenceFrequency | ''>('');
  const [until, setUntil] = useState(addDays(todayISO(), 56));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (meeting) {
      const local = toLocalInputs(meeting.startsAt);
      setTitle(meeting.title);
      setDate(local.date);
      setTime(local.time);
      setDuration(String(meeting.durationMinutes));
      setLocation(meeting.location);
      setParticipants(meeting.participants.map((p) => p.user?._id).filter(Boolean) as string[]);
    } else {
      setTitle('');
      setDate(todayISO());
      setTime('10:00');
      setDuration('60');
      setLocation('');
      setParticipants(people.map((p) => p._id));
      setFrequency('');
      setUntil(addDays(todayISO(), 56));
    }
  }, [open, meeting, people]);

  const toggle = (id: string) => setParticipants((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  const durationOptions = DURATIONS.some((d) => d.value === duration) ? DURATIONS : [...DURATIONS, { value: duration, label: `${duration} min` }];

  const submit = async () => {
    setError(null);
    if (!title.trim()) return setError('Give the meeting a title');
    if (!date) return setError('Choose a date');
    if (frequency && until < date) return setError('The series must end after the first meeting');
    const body = { title: title.trim(), location: location.trim(), startsAt: fromLocalInputs(date, time), durationMinutes: Number(duration), participants };
    try {
      if (meeting) {
        const scope = meeting.seriesId && askScope ? await askScope() : 'this';
        if (!scope) return;
        const res = await update.mutateAsync({ id: meeting._id, scope, ...body });
        void toastSuccess(res.updated > 1 ? `Updated ${res.updated} meetings` : 'Meeting updated');
      } else {
        const res = await create.mutateAsync({ ...body, recurrence: frequency ? { frequency, until } : null });
        void toastSuccess(res.created > 1 ? `Scheduled ${res.created} meetings` : 'Meeting scheduled');
        onCreated?.(res.meeting._id);
      }
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={meeting ? 'Edit meeting' : 'Schedule a meeting'}
      subtitle={meeting ? meeting.title : 'Site visits, client reviews, coordination meetings'}
      icon={meeting ? Pencil : CalendarPlus}
      width="md"
      footer={
        <>
          <Button inDrawer onClick={onClose}>
            Cancel
          </Button>
          <Button inDrawer variant="primary" icon={meeting ? Pencil : CalendarPlus} loading={create.isPending || update.isPending} onClick={submit}>
            {meeting ? 'Save' : 'Schedule'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <Alert>{error}</Alert>}
        <Field label="Title" htmlFor="m-title" required>
          <input id="m-title" className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly site coordination" autoFocus />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Date" htmlFor="m-date" required>
            <input id="m-date" type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Start time" htmlFor="m-time" required>
            <input id="m-time" type="time" className={inputCls} value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field label="Duration">
            <ThemedSelect options={durationOptions} value={duration} onChange={setDuration} />
          </Field>
        </div>
        <Field label="Location" htmlFor="m-location" hint="Room, site address or video-call link">
          <input id="m-location" className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Site office, level 4" />
        </Field>

        {!meeting && (
          <div>
            <Sec title="Repeat" icon={Repeat} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Repeats">
                <ThemedSelect options={REPEAT_OPTIONS} value={frequency} onChange={(v) => setFrequency(v as RecurrenceFrequency | '')} />
              </Field>
              {frequency && (
                <Field label="Until" htmlFor="m-until" hint="Up to 52 meetings">
                  <input id="m-until" type="date" className={inputCls} value={until} min={date} onChange={(e) => setUntil(e.target.value)} />
                </Field>
              )}
            </div>
          </div>
        )}

        <div>
          <Sec title={`Participants (${participants.length})`} />
          <div className="flex items-center gap-3 mb-2 text-xs">
            <button type="button" className="text-blue-600 dark:text-blue-400 hover:underline" onClick={() => setParticipants(people.map((p) => p._id))}>
              Select everyone
            </button>
            <button type="button" className="text-blue-600 dark:text-blue-400 hover:underline" onClick={() => setParticipants([])}>
              Clear
            </button>
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {people.map((p) => (
              <li key={p._id}>
                <label className="flex items-center gap-2.5 px-3 py-2 rounded-md border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer text-sm text-gray-700 dark:text-gray-200">
                  <input type="checkbox" className="w-4 h-4 accent-[var(--theme-primary)]" checked={participants.includes(p._id)} onChange={() => toggle(p._id)} />
                  <span className="truncate">{p.name}</span>
                  {p.kind === 'placeholder' && <span className="text-[10px] text-amber-600 dark:text-amber-400">placeholder</span>}
                </label>
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">You are always included as the organiser. Placeholders and pending invitations don’t receive emails.</p>
        </div>
      </div>
    </Drawer>
  );
}

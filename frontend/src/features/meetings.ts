'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type MeetingStatus = 'draft' | 'open' | 'closed';
export type RecurrenceFrequency = 'weekly' | 'biweekly' | 'monthly';

export interface MeetingTaskRef {
  _id: string;
  name: string;
  number: number | null;
  percentComplete: number;
  finish: string;
  assignee: string | null;
}

export interface AgendaItem {
  _id: string;
  title: string;
  notes: string;
  durationMinutes: number;
  presenter: { _id: string; name: string } | null;
  task: MeetingTaskRef | null;
  outcome: string;
  actions: MeetingTaskRef[];
}

export interface Meeting {
  _id: string;
  project: string;
  title: string;
  location: string;
  startsAt: string;
  durationMinutes: number;
  organizer: { _id: string; name: string; email?: string } | null;
  participants: { user: { _id: string; name: string; email?: string; kind?: string } | null; invitedAt: string | null; attended: boolean | null }[];
  agenda: AgendaItem[];
  minutes: string;
  status: MeetingStatus;
  seriesId: string | null;
  recurrence: { frequency: RecurrenceFrequency; until: string } | null;
  closedAt: string | null;
  closedBy: { _id: string; name: string } | null;
  createdAt: string;
}

export interface MeetingSummary extends Omit<Meeting, 'agenda' | 'minutes' | 'participants' | 'organizer'> {
  organizer: { _id: string; name: string } | null;
  participants: { user: string; invitedAt: string | null; attended: boolean | null }[];
  agendaCount: number;
  agendaMinutes: number;
  actionCount: number;
}

export interface AgendaInput {
  _id?: string;
  title: string;
  notes?: string;
  durationMinutes?: number;
  presenter?: string | null;
  task?: string | null;
  outcome?: string;
}

export interface MeetingInput {
  title: string;
  location?: string;
  startsAt: string;
  durationMinutes?: number;
  participants?: string[];
  agenda?: AgendaInput[];
}

export type Scope = 'this' | 'future';

const keys = {
  list: (projectId: string) => ['meetings', projectId] as const,
  one: (projectId: string, meetingId: string) => ['meeting', projectId, meetingId] as const,
};

export function useMeetings(projectId: string) {
  return useQuery({
    queryKey: keys.list(projectId),
    queryFn: () => api<{ meetings: MeetingSummary[]; canManage: boolean }>(`/projects/${projectId}/meetings?scope=all`),
  });
}

export function useMeeting(projectId: string, meetingId: string | null) {
  return useQuery({
    queryKey: keys.one(projectId, meetingId ?? ''),
    queryFn: () =>
      api<{ meeting: Meeting; series: { _id: string; startsAt: string; status: MeetingStatus }[]; canManage: boolean; canCreateTasks: boolean }>(
        `/projects/${projectId}/meetings/${meetingId}`,
      ),
    enabled: !!meetingId,
  });
}

export function useMeetingMutations(projectId: string) {
  const qc = useQueryClient();
  const base = `/projects/${projectId}/meetings`;
  const refresh = (meetingId?: string) => {
    void qc.invalidateQueries({ queryKey: keys.list(projectId) });
    if (meetingId) void qc.invalidateQueries({ queryKey: ['meeting', projectId, meetingId] });
    else void qc.invalidateQueries({ queryKey: ['meeting', projectId] });
  };
  /** Writes a returned meeting straight into its cache entry (no flicker), then refreshes lists. */
  const store = ({ meeting }: { meeting: Meeting }) => {
    qc.setQueryData<{ meeting: Meeting }>(keys.one(projectId, meeting._id), (old) => (old ? { ...old, meeting } : old));
    refresh(meeting._id);
  };
  return {
    create: useMutation({
      mutationFn: (body: MeetingInput & { recurrence?: { frequency: RecurrenceFrequency; until: string } | null }) =>
        api<{ meeting: Meeting; created: number }>(base, { method: 'POST', body }),
      onSuccess: () => refresh(),
    }),
    update: useMutation({
      mutationFn: ({ id, scope = 'this', ...body }: Partial<MeetingInput> & { id: string; scope?: Scope; minutes?: string; status?: 'draft' | 'open' }) =>
        api<{ meeting: Meeting; updated: number }>(`${base}/${id}?scope=${scope}`, { method: 'PATCH', body }),
      onSuccess: (data) => {
        store(data);
        if (data.updated > 1) refresh();
      },
    }),
    remove: useMutation({
      mutationFn: ({ id, scope = 'this' }: { id: string; scope?: Scope }) => api<{ deleted: number }>(`${base}/${id}?scope=${scope}`, { method: 'DELETE' }),
      onSuccess: () => refresh(),
    }),
    attendance: useMutation({
      mutationFn: ({ id, userId, attended }: { id: string; userId?: string; attended: boolean | null }) =>
        api<{ meeting: Meeting }>(`${base}/${id}/attendance`, { method: 'POST', body: { userId, attended } }),
      onSuccess: store,
    }),
    addAction: useMutation({
      mutationFn: ({ id, itemId, ...body }: { id: string; itemId: string; title: string; assignee?: string | null; dueDate?: string | null }) =>
        api<{ meeting: Meeting; taskId: string }>(`${base}/${id}/agenda/${itemId}/actions`, { method: 'POST', body }),
      onSuccess: (data) => {
        store(data);
        void qc.invalidateQueries({ queryKey: ['plan', projectId] });
      },
    }),
    invite: useMutation({ mutationFn: (id: string) => api<{ meeting: Meeting; emailed: number }>(`${base}/${id}/invite`, { method: 'POST' }), onSuccess: store }),
    close: useMutation({
      mutationFn: ({ id, minutes }: { id: string; minutes?: string }) => api<{ meeting: Meeting; emailed: number }>(`${base}/${id}/close`, { method: 'POST', body: { minutes } }),
      onSuccess: store,
    }),
    reopen: useMutation({ mutationFn: (id: string) => api<{ meeting: Meeting }>(`${base}/${id}/reopen`, { method: 'POST' }), onSuccess: store }),
  };
}

export const icsPath = (projectId: string, meetingId: string) => `/projects/${projectId}/meetings/${meetingId}/ics`;

/** "2026-11-03T04:30:00.000Z" → local "2026-11-03" and "10:00" for date/time inputs. */
export function toLocalInputs(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/** Local date + time inputs → ISO timestamp with the browser's offset applied. */
export const fromLocalInputs = (date: string, time: string) => new Date(`${date}T${time || '00:00'}:00`).toISOString();

export const fmtMeetingTime = (iso: string, durationMinutes: number) => {
  const start = new Date(iso);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const day = start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${t(start)}–${t(end)}`;
};

export const FREQUENCY_LABEL: Record<RecurrenceFrequency, string> = { weekly: 'Every week', biweekly: 'Every 2 weeks', monthly: 'Every month' };

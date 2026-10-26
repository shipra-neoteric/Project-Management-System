'use client';

import { CalendarCheck, CalendarClock, CalendarPlus, CheckSquare, ClipboardList, MapPin, Presentation, Repeat, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MeetingDetailDrawer, MEETING_STATUS } from '@/components/meetings/MeetingDetail';
import { MeetingFormDrawer } from '@/components/meetings/MeetingForm';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, EmptyState, PageLoader } from '@/components/ui/Feedback';
import { Card, FilterTabs, KpiCard, KpiGrid, rowCls, tableCls, tbodyCls, td, th, theadCls } from '@/components/ui/Layout';
import { fmtMeetingTime, useMeetings, type MeetingSummary } from '@/features/meetings';
import { useWorkspace } from '@/features/project-context';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';

type Scope = 'upcoming' | 'past' | 'all';

/** Start of the meeting plus its length: a meeting counts as upcoming until it has ended. */
const endOf = (m: MeetingSummary) => new Date(m.startsAt).getTime() + m.durationMinutes * 60_000;

export default function MeetingsPage() {
  const { projectId, ctx, plan, can } = useWorkspace();
  const { data, isLoading, error } = useMeetings(projectId);
  const [scope, setScope] = useState<Scope>('upcoming');
  const [createOpen, setCreateOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const people = useMemo(() => [...(ctx?.people.values() ?? [])], [ctx]);

  // Deep link from notifications: ?meeting=<id>
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('meeting');
    if (id) setOpenId(id);
  }, []);
  const open = useCallback((id: string | null) => {
    setOpenId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('meeting', id);
    else url.searchParams.delete('meeting');
    window.history.replaceState(null, '', url);
  }, []);

  const meetings = useMemo(() => data?.meetings ?? [], [data]);
  const now = Date.now();
  const upcoming = meetings.filter((m) => endOf(m) >= now).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = meetings.filter((m) => endOf(m) < now).sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  const weekEnd = now + 7 * 86_400_000;
  const kpis = {
    upcoming: upcoming.length,
    thisWeek: upcoming.filter((m) => new Date(m.startsAt).getTime() <= weekEnd).length,
    actions: meetings.reduce((a, m) => a + m.actionCount, 0),
    minutesPending: past.filter((m) => m.status !== 'closed').length,
  };
  const rows = scope === 'upcoming' ? upcoming : scope === 'past' ? past : [...upcoming, ...past];
  const canManage = can('manage_meetings') && data?.canManage !== false;

  if (isLoading || !plan) return <PageLoader />;
  if (error) return <Alert>{errorMessage(error, 'Could not load meetings')}</Alert>;

  return (
    <div className="space-y-4">
      <KpiGrid>
        <KpiCard label="Upcoming" value={kpis.upcoming} icon={CalendarClock} iconColor="text-blue-500" active={scope === 'upcoming'} onClick={() => setScope('upcoming')} />
        <KpiCard label="Next 7 days" value={kpis.thisWeek} icon={CalendarCheck} iconColor="text-green-500" />
        <KpiCard label="Action items created" value={kpis.actions} icon={CheckSquare} iconColor="text-purple-500" />
        <KpiCard label="Past, minutes not closed" value={kpis.minutesPending} icon={ClipboardList} iconColor="text-amber-500" active={scope === 'past'} onClick={() => setScope('past')} />
      </KpiGrid>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterTabs<Scope>
          value={scope}
          onChange={setScope}
          tabs={[
            { key: 'upcoming', label: 'Upcoming', count: upcoming.length },
            { key: 'past', label: 'Past', count: past.length },
            { key: 'all', label: 'All', count: meetings.length },
          ]}
        />
        {canManage && (
          <Button variant="primary" icon={CalendarPlus} onClick={() => setCreateOpen(true)}>
            Schedule meeting
          </Button>
        )}
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={Presentation}
            title={scope === 'past' ? 'No past meetings' : 'No meetings scheduled'}
            message={canManage ? 'Plan site visits, client reviews and coordination meetings with an agenda, minutes and action items.' : undefined}
            action={
              canManage && scope !== 'past' ? (
                <Button variant="primary" icon={CalendarPlus} onClick={() => setCreateOpen(true)}>
                  Schedule meeting
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead className={theadCls}>
                <tr>
                  <th className={th}>Meeting</th>
                  <th className={th}>When</th>
                  <th className={`${th} hidden md:table-cell`}>Where</th>
                  <th className={`${th} hidden sm:table-cell`}>People</th>
                  <th className={`${th} hidden lg:table-cell`}>Agenda</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody className={tbodyCls}>
                {rows.map((m) => {
                  const live = new Date(m.startsAt).getTime() <= now && endOf(m) >= now;
                  return (
                    <tr key={m._id} className={cn(rowCls, 'cursor-pointer')} onClick={() => open(m._id)}>
                      <td className={td}>
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{m.title}</span>
                          {m.seriesId && <Repeat className="w-3.5 h-3.5 text-gray-400 shrink-0" aria-label="Recurring" />}
                          {live && <Badge tone="danger" dot>Now</Badge>}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">Organised by {m.organizer?.name ?? '—'}</span>
                      </td>
                      <td className={`${td} text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap`}>{fmtMeetingTime(m.startsAt, m.durationMinutes)}</td>
                      <td className={`${td} hidden md:table-cell text-sm text-gray-600 dark:text-gray-300 max-w-[14rem] truncate`}>
                        {m.location ? (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5 text-gray-400" /> {m.location}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className={`${td} hidden sm:table-cell text-sm text-gray-600 dark:text-gray-300`}>
                        <span className="inline-flex items-center gap-1">
                          <Users className="w-3.5 h-3.5 text-gray-400" /> {m.participants.length}
                        </span>
                      </td>
                      <td className={`${td} hidden lg:table-cell text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap`}>
                        {m.agendaCount} item{m.agendaCount === 1 ? '' : 's'} · {m.agendaMinutes} min
                        {m.actionCount > 0 && <span className="text-gray-400"> · {m.actionCount} action{m.actionCount === 1 ? '' : 's'}</span>}
                      </td>
                      <td className={td}>
                        <Badge tone={MEETING_STATUS[m.status].tone} dot>
                          {MEETING_STATUS[m.status].label}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <MeetingFormDrawer open={createOpen} onClose={() => setCreateOpen(false)} projectId={projectId} people={people} onCreated={(id) => open(id)} />
      <MeetingDetailDrawer projectId={projectId} meetingId={openId} onClose={() => open(null)} />
    </div>
  );
}

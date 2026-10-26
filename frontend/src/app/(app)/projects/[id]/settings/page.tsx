'use client';

import { CalendarDays, Info, Mail, Pencil, Plus, ShieldAlert, Tags, Trash2, UserPlus, Users, UsersRound, X } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Alert, PageLoader } from '@/components/ui/Feedback';
import { Field, inputCls } from '@/components/ui/Field';
import { RichTextView } from '@/components/ui/RichTextEditor';
import { Card, FilterTabs, rowCls, tableCls, tbodyCls, td, th, theadCls } from '@/components/ui/Layout';
import { ThemedSelect } from '@/components/ui/ThemedSelect';
import { ProjectDrawer } from '@/features/ProjectDrawer';
import { AttributesCard, BaselinesCard, CopyCard, LifecycleCard, ModulesCard, ProgressModeCard, ProjectRatesCard } from '@/features/ProjectSettingsCards';
import { ProjectCalendarCard } from '@/features/CalendarFeedCard';
import { useDeleteProject, useGroups, useMembers, useProject, useRoles, useUpdateProject, useUserAdmin, useUsers } from '@/features/queries';
import { confirmDanger, toastError, toastSuccess } from '@/lib/alerts';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtDate, fmtDateTime, WEEKDAY_NAMES } from '@/lib/dates';
import { can, projectPeople } from '@/lib/permissions';
import { PROJECT_STATUS, roleBadge } from '@/lib/status';
import { useTheme } from '@/lib/theme';
import type { MemberRole, Project } from '@/lib/types';

export default function ProjectSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const { data: project, isLoading } = useProject(id);
  const [editOpen, setEditOpen] = useState(false);

  if (isLoading || !project) return <PageLoader />;
  const canManage = can(project, 'manage_project');
  const canManageMembers = can(project, 'manage_members');

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6">
      <Card
        title="Project details"
        icon={Info}
        actions={canManage && <Button size="sm" icon={Pencil} onClick={() => setEditOpen(true)}>Edit</Button>}
      >
        <dl className="grid grid-cols-2 gap-4 p-5">
          {[
            ['Name', project.name],
            ['Status', <Badge key="s" tone={PROJECT_STATUS[project.status].tone} dot>{PROJECT_STATUS[project.status].label}</Badge>],
            ['Start', fmtDate(project.startDate)],
            ['Finish (calculated)', fmtDate(project.finishDate)],
            ['Owner', project.owner?.name],
            ['Last updated', fmtDateTime(project.updatedAt)],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <dt className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">{label}</dt>
              <dd className="text-sm font-medium text-gray-800 dark:text-gray-100 mt-1">{value}</dd>
            </div>
          ))}
          <div className="col-span-2">
            <dt className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Description</dt>
            <dd className="mt-1">
              <RichTextView value={project.description} empty="—" />
            </dd>
          </div>
        </dl>
      </Card>

      <CalendarCard project={project} canManage={canManage} />
      <CategoriesCard project={project} canManage={canManage} />
      <MembersCard project={project} canManage={canManageMembers} />
      <AttributesCard project={project} canManage={canManage} people={[...projectPeople(project).values()]} />
      <LifecycleCard project={project} canManage={canManage} />
      <BaselinesCard project={project} canManage={canManage} />
      <ProgressModeCard project={project} canManage={canManage} />
      <ProjectRatesCard project={project} people={[...projectPeople(project).values()]} />
      <ModulesCard project={project} canManage={canManage} />
      <CopyCard project={project} canManage={canManage} />
      <ProjectCalendarCard projectId={project._id} />
      {can(project, 'delete_project') && <DangerZone project={project} />}

      <ProjectDrawer open={editOpen} project={project} onClose={() => setEditOpen(false)} />
    </div>
  );
}

function CalendarCard({ project, canManage }: { project: Project; canManage: boolean }) {
  const update = useUpdateProject(project._id);
  const { themeColor } = useTheme();
  const [days, setDays] = useState<number[]>(project.workingDays);
  const [holidays, setHolidays] = useState<string[]>(project.holidays);
  const [newHoliday, setNewHoliday] = useState('');

  useEffect(() => {
    setDays(project.workingDays);
    setHolidays(project.holidays);
  }, [project.workingDays, project.holidays]);

  const dirty = JSON.stringify([...days].sort()) !== JSON.stringify(project.workingDays) || JSON.stringify(holidays) !== JSON.stringify(project.holidays);

  const save = async () => {
    if (!days.length) return void toastError('Select at least one working day');
    try {
      await update.mutateAsync({ workingDays: days, holidays });
      void toastSuccess('Calendar saved and plan rescheduled');
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  return (
    <Card
      title="Working calendar"
      icon={CalendarDays}
      actions={canManage && dirty && <Button size="sm" variant="primary" loading={update.isPending} onClick={save}>Save & reschedule</Button>}
    >
      <div className="p-5 space-y-5">
        <div>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Working days</p>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => {
              const on = days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  disabled={!canManage}
                  onClick={() => setDays(on ? days.filter((x) => x !== d) : [...days, d])}
                  aria-pressed={on}
                  className={cn(
                    'w-12 h-9 rounded-lg text-sm font-medium border transition-colors disabled:cursor-not-allowed',
                    on ? 'text-white border-transparent' : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700',
                  )}
                  style={on ? { backgroundColor: themeColor } : undefined}
                >
                  {WEEKDAY_NAMES[d]}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Holidays (non-working dates)</p>
          {canManage && (
            <div className="flex gap-2 mb-3">
              <input type="date" className={cn(inputCls, 'max-w-48')} value={newHoliday} onChange={(e) => setNewHoliday(e.target.value)} aria-label="Holiday date" />
              <Button
                icon={Plus}
                disabled={!newHoliday || holidays.includes(newHoliday)}
                onClick={() => {
                  setHolidays([...holidays, newHoliday].sort());
                  setNewHoliday('');
                }}
              >
                Add
              </Button>
            </div>
          )}
          {holidays.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">No holidays added.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {holidays.map((h) => (
                <span key={h} className="inline-flex items-center gap-1 pl-3 pr-1 py-1 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                  {fmtDate(h)}
                  {canManage && (
                    <button type="button" onClick={() => setHolidays(holidays.filter((x) => x !== h))} className="p-0.5 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600" aria-label={`Remove ${h}`} title="Remove">
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function CategoriesCard({ project, canManage }: { project: Project; canManage: boolean }) {
  const update = useUpdateProject(project._id);
  const [name, setName] = useState('');
  const categories = project.categories ?? [];

  const save = async (next: { _id?: string; name: string }[], message: string) => {
    try {
      await update.mutateAsync({ categories: next });
      void toastSuccess(message);
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  const rename = async (id: string, current: string) => {
    const Swal = (await import('sweetalert2')).default;
    const result = await Swal.fire({ title: 'Rename category', input: 'text', inputValue: current, showCancelButton: true, confirmButtonText: 'Save' });
    if (!result.isConfirmed || !String(result.value).trim()) return;
    await save(categories.map((c) => (c._id === id ? { _id: c._id, name: String(result.value).trim() } : c)), 'Category renamed');
  };

  return (
    <Card title="Categories" icon={Tags}>
      <div className="p-5 space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">Group tasks by area of work (e.g. Civil, MEP, Interiors). Use them in filters, the board and the table.</p>
        {canManage && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              void save([...categories, { name: name.trim() }], 'Category added').then(() => setName(''));
            }}
          >
            <input className={inputCls} value={name} maxLength={60} placeholder="New category name" onChange={(e) => setName(e.target.value)} aria-label="New category name" />
            <Button type="submit" icon={Plus} disabled={!name.trim()} loading={update.isPending}>
              Add
            </Button>
          </form>
        )}
        {categories.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">No categories yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <span key={c._id} className="inline-flex items-center gap-1 pl-3 pr-1 py-1 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                {c.name}
                {canManage && (
                  <>
                    <button type="button" onClick={() => rename(c._id, c.name)} className="p-0.5 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600" aria-label={`Rename ${c.name}`} title="Rename">
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (await confirmDanger(`Remove the category "${c.name}"?`, 'Tasks in this category become uncategorised.', 'Remove')) {
                          await save(categories.filter((x) => x._id !== c._id), 'Category removed');
                        }
                      }}
                      className="p-0.5 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600"
                      aria-label={`Remove ${c.name}`}
                      title="Remove"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function MembersCard({ project, canManage }: { project: Project; canManage: boolean }) {
  const users = useUsers();
  const groups = useGroups(canManage);
  const roles = useRoles();
  const admin = useUserAdmin();
  const { add, update, remove } = useMembers(project._id);
  const [kind, setKind] = useState<'user' | 'group' | 'invite'>('user');
  const [target, setTarget] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('member');

  const roleOptions = useMemo(
    () =>
      (roles.data?.roles ?? []).map((r) => {
        const badge = roleBadge(r.key ?? r._id, r.name);
        return { value: r.key ?? r._id, label: r.name, description: r.key ? badge.description : `${r.permissions.length} permissions` };
      }),
    [roles.data],
  );
  const roleNames = useMemo(() => new Map((roles.data?.roles ?? []).map((r) => [r.key ?? r._id, r.name])), [roles.data]);

  const candidates = useMemo(() => {
    if (kind === 'group') {
      const taken = new Set(project.members.map((m) => m.group?._id).filter(Boolean));
      return (groups.data ?? []).filter((g) => !taken.has(g._id)).map((g) => ({ value: g._id, label: g.name, description: `${g.members.length} member${g.members.length === 1 ? '' : 's'}` }));
    }
    const taken = new Set([project.owner?._id, ...project.members.map((m) => m.user?._id)]);
    return (users.data ?? [])
      .filter((u) => u.isActive && !taken.has(u._id))
      .map((u) => ({ value: u._id, label: u.name, description: u.kind === 'placeholder' ? 'Placeholder' : u.invited ? `${u.email} · invited` : u.email }));
  }, [kind, users.data, groups.data, project]);

  const run = async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn();
      void toastSuccess(success);
      return true;
    } catch (err) {
      void toastError(errorMessage(err));
      return false;
    }
  };

  const onAdd = async () => {
    if (kind === 'invite') {
      if (await run(() => admin.invite.mutateAsync({ email: email.trim(), projectId: project._id, role }), `Invitation sent to ${email.trim()}`)) setEmail('');
      return;
    }
    const body = kind === 'group' ? { groupId: target, role } : { userId: target, role };
    if (await run(() => add.mutateAsync(body), kind === 'group' ? 'Group added' : 'Member added')) setTarget('');
  };

  const memberKey = (m: Project['members'][number]) => m.user?._id ?? m.group?._id ?? '';
  const memberName = (m: Project['members'][number]) => m.user?.name ?? m.group?.name ?? 'Deleted user';

  return (
    <Card title="Team members" icon={Users} className="xl:col-span-2">
      {canManage && (
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 space-y-3">
          <FilterTabs<'user' | 'group' | 'invite'>
            value={kind}
            onChange={(k) => {
              setKind(k);
              setTarget('');
            }}
            tabs={[
              { key: 'user', label: 'Person or placeholder', icon: UserPlus },
              { key: 'group', label: 'Group', icon: UsersRound },
              { key: 'invite', label: 'Invite by email', icon: Mail },
            ]}
          />
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_220px_auto] gap-3 items-end">
            {kind === 'invite' ? (
              <Field label="Email address" htmlFor="invite-email" hint="They get an email link to choose a password and join this project.">
                <input id="invite-email" type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
              </Field>
            ) : (
              <Field label={kind === 'group' ? 'Group' : 'Person'}>
                <ThemedSelect
                  options={candidates}
                  value={target}
                  onChange={setTarget}
                  placeholder={candidates.length ? (kind === 'group' ? 'Choose a group…' : 'Choose a person…') : kind === 'group' ? 'No groups to add' : 'Everyone is already a member'}
                  searchable
                  disabled={!candidates.length}
                />
              </Field>
            )}
            <Field label="Role">
              <ThemedSelect options={roleOptions} value={role} onChange={(v) => setRole(v)} />
            </Field>
            <Button
              variant="primary"
              icon={kind === 'invite' ? Mail : UserPlus}
              disabled={kind === 'invite' ? !/^\S+@\S+\.\S+$/.test(email.trim()) : !target}
              loading={add.isPending || admin.invite.isPending}
              onClick={onAdd}
            >
              {kind === 'invite' ? 'Invite' : 'Add'}
            </Button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className={tableCls}>
          <thead className={theadCls}>
            <tr>
              <th className={th}>Name</th>
              <th className={`${th} hidden sm:table-cell`}>Details</th>
              <th className={th}>Role</th>
              <th className={`${th} text-right w-20`}>Actions</th>
            </tr>
          </thead>
          <tbody className={tbodyCls}>
            <tr className={rowCls}>
              <td className={`${td} text-sm font-medium text-gray-900 dark:text-white`}>{project.owner?.name}</td>
              <td className={`${td} hidden sm:table-cell text-sm text-gray-600 dark:text-gray-300`}>{project.owner?.email}</td>
              <td className={td}>
                <Badge tone="purple">Owner</Badge>
              </td>
              <td className={td} />
            </tr>
            {project.members.map((m) => {
              const badge = roleBadge(m.role, roleNames.get(m.role));
              return (
                <tr key={memberKey(m)} className={rowCls}>
                  <td className={`${td} text-sm font-medium text-gray-900 dark:text-white`}>
                    <span className="inline-flex items-center gap-2">
                      {m.group ? <UsersRound className="w-4 h-4 text-gray-400" /> : null}
                      {memberName(m)}
                      {m.user?.kind === 'placeholder' && <Badge tone="warning">Placeholder</Badge>}
                      {m.user?.invited && <Badge tone="info">Invited</Badge>}
                    </span>
                  </td>
                  <td className={`${td} hidden sm:table-cell text-sm text-gray-600 dark:text-gray-300`}>
                    {m.group ? (
                      <span title={m.group.members.map((u) => u.name).join(', ')}>
                        Group · {m.group.members.length} member{m.group.members.length === 1 ? '' : 's'}
                      </span>
                    ) : (
                      m.user?.email
                    )}
                  </td>
                  <td className={`${td} w-56`}>
                    {canManage ? (
                      <ThemedSelect compact options={roleOptions} value={m.role} onChange={(v) => run(() => update.mutateAsync({ memberId: memberKey(m), role: v }), 'Role updated')} />
                    ) : (
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    )}
                  </td>
                  <td className={`${td} text-right`}>
                    {canManage && (
                      <IconButton
                        icon={Trash2}
                        label="Remove from project"
                        tone="delete"
                        onClick={async () => {
                          if (await confirmDanger(`Remove ${memberName(m)}?`, m.group ? 'Group members lose the access this membership gave them.' : 'They will lose access to this project.', 'Remove')) {
                            await run(() => remove.mutateAsync(memberKey(m)), 'Member removed');
                          }
                        }}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {project.members.length === 0 && <p className="px-5 py-4 text-sm text-gray-400 dark:text-gray-500">Only the owner has access. Add teammates to collaborate.</p>}
    </Card>
  );
}

function DangerZone({ project }: { project: Project }) {
  const remove = useDeleteProject();
  const router = useRouter();
  return (
    <Card title="Danger zone" icon={ShieldAlert}>
      <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">Permanently delete this project, its tasks and resources.</p>
        <Button
          variant="danger"
          icon={Trash2}
          loading={remove.isPending}
          onClick={async () => {
            if (!(await confirmDanger(`Delete "${project.name}"?`, 'All tasks and resources will be permanently deleted.'))) return;
            try {
              await remove.mutateAsync(project._id);
              void toastSuccess('Project deleted');
              router.replace('/projects');
            } catch (err) {
              void toastError(errorMessage(err));
            }
          }}
        >
          Delete project
        </Button>
      </div>
    </Card>
  );
}

'use client';

import { Coins, Mail, MailPlus, Plus, RefreshCw, Replace, Save, ShieldCheck, Trash2, UserCog, UserRound, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { Alert, EmptyState, PageLoader } from '@/components/ui/Feedback';
import { Field, inputCls, Sec } from '@/components/ui/Field';
import { FilterTabs, KpiCard, KpiGrid, Page, PageHeader, rowCls, SearchInput, tableCls, tbodyCls, td, th, theadCls } from '@/components/ui/Layout';
import { ThemedSelect } from '@/components/ui/ThemedSelect';
import { AdminGate } from '@/features/AdminGate';
import { useDefaultRates, useGlobalRoles, useUpdateUser, useUserAdmin, useUsers } from '@/features/queries';
import { DEFAULT_SCHEDULE, WorkScheduleFields } from '@/features/WorkScheduleFields';
import { confirmAction, confirmDanger, toastError, toastSuccess } from '@/lib/alerts';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { fmtDate, todayISO } from '@/lib/dates';
import { useMoney } from '@/lib/money';
import { hasGlobal } from '@/lib/permissions';
import { useTheme } from '@/lib/theme';
import type { User, WorkSchedule } from '@/lib/types';

type Tab = 'users' | 'placeholders' | 'invitations';

export default function UsersPage() {
  return (
    <AdminGate perm="manage_users">
      <UsersContent />
    </AdminGate>
  );
}

function UsersContent() {
  const { data: users = [], isLoading, error } = useUsers();
  const globalRoles = useGlobalRoles();
  const admin = useUserAdmin();
  const { themeColor } = useTheme();
  const [tab, setTab] = useState<Tab>('users');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<User | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [placeholderOpen, setPlaceholderOpen] = useState(false);
  const [replacing, setReplacing] = useState<User | null>(null);

  const groups = useMemo(
    () => ({
      users: users.filter((u) => u.kind !== 'placeholder' && !u.invited),
      placeholders: users.filter((u) => u.kind === 'placeholder'),
      invitations: users.filter((u) => u.kind !== 'placeholder' && u.invited),
    }),
    [users],
  );
  const roleNames = useMemo(() => new Map((globalRoles.data?.roles ?? []).map((r) => [r._id, r.name])), [globalRoles.data]);
  const term = search.trim().toLowerCase();
  const visible = groups[tab].filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(term));

  const run = async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn();
      void toastSuccess(success);
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  const onDelete = async (u: User) => {
    const what = u.kind === 'placeholder' ? 'placeholder' : 'invitation';
    if (!(await confirmDanger(`Delete ${what} "${u.name}"?`, 'Their project memberships and task assignments are removed.'))) return;
    await run(() => admin.remove.mutateAsync(u._id), u.kind === 'placeholder' ? 'Placeholder deleted' : 'Invitation withdrawn');
  };

  // Default global roles apply to everyone, so they are listed once in the header rather than per user.
  const defaultRoles = (globalRoles.data?.roles ?? []).filter((r) => r.isDefault).map((r) => r.name);

  return (
    <Page>
      <PageHeader
        title="Users"
        subtitle={
          <>
            People, placeholders for not-yet-hired roles, and pending invitations.
            {defaultRoles.length > 0 && <span className="text-xs text-gray-400"> Everyone gets: {defaultRoles.join(', ')}.</span>}
          </>
        }
        actions={
          <>
            <Button icon={UserRound} onClick={() => setPlaceholderOpen(true)}>
              Add placeholder
            </Button>
            <Button variant="primary" icon={MailPlus} onClick={() => setInviteOpen(true)}>
              Invite user
            </Button>
          </>
        }
      />
      <KpiGrid>
        <KpiCard label="Users" value={groups.users.length} icon={Users} iconColor="text-blue-500" active={tab === 'users'} onClick={() => setTab('users')} />
        <KpiCard label="Admins" value={groups.users.filter((u) => u.role === 'Admin').length} icon={ShieldCheck} iconColor="text-purple-500" />
        <KpiCard label="Placeholders" value={groups.placeholders.length} icon={UserRound} iconColor="text-amber-500" active={tab === 'placeholders'} onClick={() => setTab('placeholders')} />
        <KpiCard label="Pending invitations" value={groups.invitations.length} icon={Mail} iconColor="text-green-500" active={tab === 'invitations'} onClick={() => setTab('invitations')} />
      </KpiGrid>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <FilterTabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'users', label: 'Users', icon: Users, count: groups.users.length },
            { key: 'placeholders', label: 'Placeholders', icon: UserRound, count: groups.placeholders.length },
            { key: 'invitations', label: 'Invitations', icon: Mail, count: groups.invitations.length },
          ]}
        />
        <SearchInput value={search} onChange={setSearch} placeholder="Search…" />
      </div>
      {error && <Alert>{errorMessage(error)}</Alert>}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        {isLoading ? (
          <PageLoader />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={tab === 'placeholders' ? UserRound : tab === 'invitations' ? Mail : Users}
            title={tab === 'placeholders' ? 'No placeholders' : tab === 'invitations' ? 'No pending invitations' : 'No users found'}
            message={
              tab === 'placeholders'
                ? 'Placeholders stand in for people you have not hired or named yet. Plan with them, then replace them with a real user.'
                : tab === 'invitations'
                  ? 'Invite people by email; they appear here until they accept.'
                  : 'Try a different search'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead className={theadCls}>
                <tr>
                  <th className={th}>{tab === 'placeholders' ? 'Placeholder' : 'User'}</th>
                  {tab === 'users' && (
                    <>
                      <th className={th}>Access</th>
                      <th className={`${th} hidden md:table-cell`}>Working hours</th>
                      <th className={th}>Status</th>
                    </>
                  )}
                  <th className={`${th} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody className={tbodyCls}>
                {visible.map((u) => (
                  <tr key={u._id} className={cn(rowCls, tab === 'users' && 'cursor-pointer')} onClick={tab === 'users' ? () => setEditing(u) : undefined}>
                    <td className={td}>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{u.name}</p>
                      {u.email && <p className="text-xs text-gray-500 dark:text-gray-400">{u.email}</p>}
                    </td>
                    {tab === 'users' && (
                      <>
                        <td className={td}>
                          <div className="flex flex-wrap gap-1">
                            <Badge tone={u.role === 'Admin' ? 'purple' : 'neutral'}>{u.role}</Badge>
                            {(u.globalRoles ?? []).map((id) => roleNames.get(id) && <Badge key={id} tone="info">{roleNames.get(id)}</Badge>)}
                          </div>
                        </td>
                        <td className={`${td} hidden md:table-cell text-sm text-gray-600 dark:text-gray-300 tabular-nums`}>
                          {u.workSchedule?.hoursPerDay ?? 8} h × {u.workSchedule?.workingDays.length ?? 5} days
                        </td>
                        <td className={td}>
                          <Badge tone={u.isActive ? 'success' : 'danger'} dot>
                            {u.isActive ? 'Active' : 'Deactivated'}
                          </Badge>
                        </td>
                      </>
                    )}
                    <td className={`${td} text-right whitespace-nowrap`} onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {tab === 'users' && <IconButton icon={UserCog} label="Edit user" tone="edit" onClick={() => setEditing(u)} />}
                        {tab === 'placeholders' && (
                          <Button size="sm" icon={Replace} onClick={() => setReplacing(u)}>
                            Replace with user
                          </Button>
                        )}
                        {tab === 'invitations' && (
                          <IconButton icon={RefreshCw} label="Resend invitation" onClick={() => run(() => admin.resendInvite.mutateAsync(u._id), `Invitation sent again to ${u.email}`)} />
                        )}
                        {tab !== 'users' && <IconButton icon={Trash2} label="Delete" tone="delete" onClick={() => onDelete(u)} />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: themeColor }} />
        Click a user to change their access, working hours and hourly rates.
      </p>

      {editing && <UserDrawer key={editing._id} user={editing} onClose={() => setEditing(null)} />}
      {inviteOpen && <InviteDrawer onClose={() => setInviteOpen(false)} />}
      {placeholderOpen && <PlaceholderDrawer onClose={() => setPlaceholderOpen(false)} />}
      {replacing && <ReplaceDrawer placeholder={replacing} users={groups.users.filter((u) => u.isActive)} onClose={() => setReplacing(null)} />}
    </Page>
  );
}

function UserDrawer({ user, onClose }: { user: User; onClose: () => void }) {
  const { user: me, isAdmin } = useAuth();
  const update = useUpdateUser();
  const globalRoles = useGlobalRoles();
  const self = user._id === me?._id;
  const [name, setName] = useState(user.name);
  const [admin, setAdmin] = useState(user.role === 'Admin');
  const [active, setActive] = useState(user.isActive);
  const [roles, setRoles] = useState<string[]>(user.globalRoles ?? []);
  const [schedule, setSchedule] = useState<WorkSchedule>(user.workSchedule ?? DEFAULT_SCHEDULE);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (name.trim().length < 2) return setError('Name must be at least 2 characters');
    if (!active && user.isActive && !(await confirmDanger(`Deactivate ${user.name}?`, 'They will no longer be able to sign in.', 'Deactivate'))) return;
    const role = admin ? 'Admin' : 'User';
    try {
      await update.mutateAsync({
        id: user._id,
        name: name.trim(),
        isActive: active,
        globalRoles: roles,
        workSchedule: schedule,
        ...(isAdmin && role !== user.role ? { role } : {}),
      });
      void toastSuccess('User saved');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      icon={UserCog}
      title={user.name}
      subtitle={user.email}
      footer={
        <>
          <Button inDrawer onClick={onClose}>
            Cancel
          </Button>
          <Button inDrawer variant="primary" icon={Save} loading={update.isPending} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {error && <Alert>{error}</Alert>}
        <section>
          <Sec title="Account" />
          <div className="space-y-4">
            <Field label="Name" htmlFor="u-name" required>
              <input id="u-name" className={inputCls} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </Field>
            <label className={cn('flex items-center gap-3 text-sm text-gray-700 dark:text-gray-200', (!isAdmin || self) && 'opacity-60')}>
              <input type="checkbox" checked={admin} disabled={!isAdmin || self} onChange={(e) => setAdmin(e.target.checked)} className="w-4 h-4 accent-[var(--theme-primary)]" />
              Administrator (full access to every project and setting)
            </label>
            <label className={cn('flex items-center gap-3 text-sm text-gray-700 dark:text-gray-200', self && 'opacity-60')}>
              <input type="checkbox" checked={active} disabled={self} onChange={(e) => setActive(e.target.checked)} className="w-4 h-4 accent-[var(--theme-primary)]" />
              Active (can sign in)
            </label>
          </div>
        </section>

        <section>
          <Sec title="Organisation roles" />
          {globalRoles.isLoading ? (
            <PageLoader />
          ) : (
            <div className="space-y-2">
              {(globalRoles.data?.roles ?? []).map((r) => {
                const on = r.isDefault || roles.includes(r._id);
                return (
                  <label key={r._id} className="flex items-start gap-3 text-sm text-gray-700 dark:text-gray-200">
                    <input
                      type="checkbox"
                      className="w-4 h-4 mt-0.5 accent-[var(--theme-primary)]"
                      checked={on}
                      disabled={r.isDefault}
                      onChange={() => setRoles(roles.includes(r._id) ? roles.filter((x) => x !== r._id) : [...roles, r._id])}
                    />
                    <span>
                      <span className="font-medium">{r.name}</span>
                      {r.isDefault && <span className="text-xs text-gray-400"> · everyone</span>}
                      <span className="block text-xs text-gray-500 dark:text-gray-400">
                        {r.permissions.map((p) => globalRoles.data?.permissions.find((x) => x.key === p)?.label ?? p).join(' · ') || 'No permissions'}
                      </span>
                    </span>
                  </label>
                );
              })}
              {!globalRoles.data?.roles.length && <p className="text-sm text-gray-400">No organisation roles yet. Create them under Roles &amp; permissions.</p>}
            </div>
          )}
        </section>

        <section>
          <Sec title="Working hours" />
          <WorkScheduleFields value={schedule} onChange={setSchedule} idPrefix="u-ws" />
        </section>

        {hasGlobal(me, 'manage_rates') && <RatesSection userId={user._id} />}
      </div>
    </Drawer>
  );
}

/** Default hourly rates with a history: the rate valid on a time entry's date prices it. */
function RatesSection({ userId }: { userId: string }) {
  const rates = useDefaultRates(userId);
  const { money, currency } = useMoney();
  const [rate, setRate] = useState('');
  const [validFrom, setValidFrom] = useState(todayISO());
  const today = todayISO();
  const list = rates.data ?? [];
  const current = list.find((r) => r.validFrom <= today);

  const add = async () => {
    try {
      await rates.set.mutateAsync({ user: userId, rate: Number(rate), validFrom });
      setRate('');
      void toastSuccess('Rate saved; time entries were re-priced');
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  return (
    <section>
      <Sec title="Default hourly rate" icon={Coins} />
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Used to cost logged time unless a project sets its own rate. Current: <span className="font-semibold text-gray-700 dark:text-gray-200">{current ? money(current.rate) : 'not set'}</span>
      </p>
      <div className="grid grid-cols-[1fr_1fr_auto] gap-3 items-end mb-3">
        <Field label={`Rate per hour (${currency})`} htmlFor="rate-value">
          <input id="rate-value" type="number" min={0} step="0.01" className={inputCls} value={rate} onChange={(e) => setRate(e.target.value)} />
        </Field>
        <Field label="Valid from" htmlFor="rate-from">
          <input id="rate-from" type="date" className={inputCls} value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        </Field>
        <Button inDrawer icon={Plus} loading={rates.set.isPending} disabled={rate.trim() === '' || Number(rate) < 0 || !validFrom} onClick={add}>
          Add
        </Button>
      </div>
      {list.length > 0 && (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700 border border-gray-100 dark:border-gray-700 rounded-md">
          {list.map((r) => (
            <li key={r._id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="flex-1 text-gray-700 dark:text-gray-200">
                from {fmtDate(r.validFrom)}
                {r === current && <Badge tone="success" className="ml-2">Current</Badge>}
              </span>
              <span className="font-medium tabular-nums text-gray-900 dark:text-white">{money(r.rate)}</span>
              <IconButton
                icon={Trash2}
                label="Delete rate"
                tone="delete"
                onClick={async () => {
                  if (!(await confirmDanger('Delete this rate?', 'Time entries in this period are re-priced with the remaining rates.'))) return;
                  try {
                    await rates.remove.mutateAsync(r._id);
                    void toastSuccess('Rate deleted');
                  } catch (err) {
                    void toastError(errorMessage(err));
                  }
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function InviteDrawer({ onClose }: { onClose: () => void }) {
  const { invite } = useUserAdmin();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter a valid email address');
    try {
      await invite.mutateAsync({ email: email.trim(), ...(name.trim() ? { name: name.trim() } : {}) });
      void toastSuccess(`Invitation sent to ${email.trim()}`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      icon={MailPlus}
      width="md"
      title="Invite user"
      subtitle="They receive a link to choose a password"
      footer={
        <>
          <Button inDrawer onClick={onClose}>
            Cancel
          </Button>
          <Button inDrawer variant="primary" icon={Mail} loading={invite.isPending} onClick={send}>
            Send invitation
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Email" htmlFor="inv-email" required>
          <input id="inv-email" type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
        </Field>
        <Field label="Name" htmlFor="inv-name" hint="Optional — they can change it when accepting">
          <input id="inv-name" className={inputCls} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Alert tone="info">To invite someone straight into a project, use the project&apos;s Settings &amp; team tab instead.</Alert>
      </div>
    </Drawer>
  );
}

function PlaceholderDrawer({ onClose }: { onClose: () => void }) {
  const { addPlaceholder } = useUserAdmin();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (name.trim().length < 2) return setError('Name is required');
    try {
      await addPlaceholder.mutateAsync(name.trim());
      void toastSuccess('Placeholder added');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      icon={UserRound}
      width="md"
      title="Add placeholder"
      subtitle="Plan work for a role before you know who fills it"
      footer={
        <>
          <Button inDrawer onClick={onClose}>
            Cancel
          </Button>
          <Button inDrawer variant="primary" icon={Save} loading={addPlaceholder.isPending} onClick={save}>
            Add
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Name" htmlFor="ph-name" required hint="e.g. “Site engineer (to hire)”">
          <input id="ph-name" className={inputCls} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <p className="text-sm text-gray-500 dark:text-gray-400">Placeholders can be added to projects and assigned tasks, but cannot sign in or receive emails.</p>
      </div>
    </Drawer>
  );
}

function ReplaceDrawer({ placeholder, users, onClose }: { placeholder: User; users: User[]; onClose: () => void }) {
  const { replacePlaceholder } = useUserAdmin();
  const [userId, setUserId] = useState('');
  const target = users.find((u) => u._id === userId);

  const replace = async () => {
    if (!target) return;
    if (!(await confirmAction(`Replace ${placeholder.name}?`, `${target.name} takes over all memberships, task assignments and resources. The placeholder is then deleted.`, 'Replace', '#3b82f6'))) return;
    try {
      await replacePlaceholder.mutateAsync({ id: placeholder._id, userId });
      void toastSuccess(`${target.name} replaced ${placeholder.name}`);
      onClose();
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      icon={Replace}
      width="md"
      title="Replace placeholder"
      subtitle={placeholder.name}
      footer={
        <>
          <Button inDrawer onClick={onClose}>
            Cancel
          </Button>
          <Button inDrawer variant="primary" icon={Replace} disabled={!userId} loading={replacePlaceholder.isPending} onClick={replace}>
            Replace
          </Button>
        </>
      }
    >
      <Field label="Real user">
        <ThemedSelect options={users.map((u) => ({ value: u._id, label: u.name, description: u.email }))} value={userId} onChange={setUserId} placeholder="Choose a user…" searchable />
      </Field>
    </Drawer>
  );
}


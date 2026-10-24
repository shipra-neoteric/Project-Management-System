'use client';

import { Pencil, Plus, Trash2, UsersRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { Alert, EmptyState, PageLoader } from '@/components/ui/Feedback';
import { Field, inputCls, textareaCls } from '@/components/ui/Field';
import { Page, PageHeader, rowCls, SearchInput, tableCls, tbodyCls, td, th, theadCls } from '@/components/ui/Layout';
import { AdminGate } from '@/features/AdminGate';
import { useGroups, useUsers } from '@/features/queries';
import { confirmDanger, toastError, toastSuccess } from '@/lib/alerts';
import { errorMessage } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import type { Group, UserRef } from '@/lib/types';

export default function GroupsPage() {
  return (
    <AdminGate perm="manage_users">
      <GroupsContent />
    </AdminGate>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/** Overlapping initials for the first few members. */
function Avatars({ people }: { people: UserRef[] }) {
  const shown = people.slice(0, 5);
  return (
    <div className="flex items-center">
      {shown.map((u, i) => (
        <span
          key={u._id}
          title={u.name}
          className="w-7 h-7 rounded-full theme-gradient text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white dark:ring-gray-800"
          style={{ marginLeft: i ? -8 : 0 }}
        >
          {initials(u.name)}
        </span>
      ))}
      {people.length > shown.length && <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">+{people.length - shown.length}</span>}
    </div>
  );
}

function GroupsContent() {
  const { data: groups = [], isLoading, error, create, update, remove } = useGroups();
  const [editing, setEditing] = useState<Group | 'new' | null>(null);
  const [search, setSearch] = useState('');

  const visible = groups.filter((g) => `${g.name} ${g.description}`.toLowerCase().includes(search.trim().toLowerCase()));

  const onDelete = async (g: Group) => {
    if (!(await confirmDanger(`Delete the group "${g.name}"?`, 'Projects the group belongs to lose this membership. People keep their own memberships.'))) return;
    try {
      await remove.mutateAsync(g._id);
      void toastSuccess('Group deleted');
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  return (
    <Page>
      <PageHeader
        title="Groups"
        subtitle="Add a group to a project once and all its members get access with the group's role."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
            New group
          </Button>
        }
      />
      <SearchInput value={search} onChange={setSearch} placeholder="Search groups…" />
      {error && <Alert>{errorMessage(error)}</Alert>}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        {isLoading ? (
          <PageLoader />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={UsersRound}
            title={groups.length ? 'No groups match your search' : 'No groups yet'}
            message={groups.length ? undefined : 'Create teams such as “Site engineers” or “Finance” and add them to projects in one step.'}
          />
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className={tableCls}>
              <thead className={theadCls}>
                <tr>
                  <th className={th}>Group</th>
                  <th className={`${th} hidden md:table-cell`}>Description</th>
                  <th className={th}>Members</th>
                  <th className={`${th} text-right w-24`}>Actions</th>
                </tr>
              </thead>
              <tbody className={tbodyCls}>
                {visible.map((g) => (
                  <tr key={g._id} className={`${rowCls} cursor-pointer`} onClick={() => setEditing(g)}>
                    <td className={`${td} text-sm font-medium text-gray-900 dark:text-white whitespace-nowrap`}>{g.name}</td>
                    <td className={`${td} hidden md:table-cell text-sm text-gray-600 dark:text-gray-300 max-w-md truncate`}>{g.description || '—'}</td>
                    <td className={td}>
                      <div className="flex items-center gap-3">
                        <Avatars people={g.members} />
                        <span className="text-sm text-gray-600 dark:text-gray-300 tabular-nums whitespace-nowrap">
                          {g.members.length} member{g.members.length === 1 ? '' : 's'}
                        </span>
                      </div>
                    </td>
                    <td className={`${td} text-right whitespace-nowrap`} onClick={(e) => e.stopPropagation()}>
                      <IconButton icon={Pencil} label="Edit group" tone="edit" onClick={() => setEditing(g)} />
                      <IconButton icon={Trash2} label="Delete group" tone="delete" onClick={() => onDelete(g)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <GroupDrawer
        group={editing}
        saving={create.isPending || update.isPending}
        onClose={() => setEditing(null)}
        onSave={async (body) => {
          try {
            if (editing === 'new') await create.mutateAsync(body);
            else if (editing) await update.mutateAsync({ id: editing._id, ...body });
            void toastSuccess(editing === 'new' ? 'Group created' : 'Group saved');
            setEditing(null);
          } catch (err) {
            void toastError(errorMessage(err));
          }
        }}
      />
    </Page>
  );
}

function GroupDrawer({
  group,
  saving,
  onClose,
  onSave,
}: {
  group: Group | 'new' | null;
  saving: boolean;
  onClose: () => void;
  onSave: (body: { name: string; description: string; members: string[] }) => void;
}) {
  const { themeColor } = useTheme();
  const users = useUsers();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [members, setMembers] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const g = group && group !== 'new' ? group : null;
    setName(g?.name ?? '');
    setDescription(g?.description ?? '');
    setMembers(new Set(g?.members.map((m) => m._id) ?? []));
    setFilter('');
  }, [group]);

  const people = useMemo(
    () =>
      (users.data ?? [])
        .filter((u) => u.isActive || members.has(u._id))
        .filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(filter.trim().toLowerCase()))
        .sort((a, b) => Number(members.has(b._id)) - Number(members.has(a._id)) || a.name.localeCompare(b.name)),
    // Re-sort only when the list or filter changes, not on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [users.data, filter, group],
  );

  const toggle = (id: string) =>
    setMembers((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Drawer
      open={!!group}
      onClose={onClose}
      title={group === 'new' ? 'New group' : 'Edit group'}
      subtitle={group && group !== 'new' ? group.name : 'People who work together'}
      icon={UsersRound}
      footer={
        <>
          <Button inDrawer onClick={onClose}>
            Cancel
          </Button>
          <Button inDrawer variant="primary" disabled={!name.trim()} loading={saving} onClick={() => onSave({ name: name.trim(), description: description.trim(), members: [...members] })}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Name" htmlFor="group-name" required>
          <input id="group-name" className={inputCls} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description" htmlFor="group-description">
          <textarea id="group-description" className={textareaCls} value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label={`Members (${members.size})`}>
          <div className="rounded-md border border-gray-200 dark:border-gray-700">
            <div className="p-2 border-b border-gray-100 dark:border-gray-700">
              <input type="search" className={inputCls} placeholder="Filter people…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter people" />
            </div>
            <div className="max-h-80 overflow-y-auto custom-scrollbar p-1">
              {users.isLoading ? (
                <PageLoader />
              ) : people.length === 0 ? (
                <p className="px-3 py-4 text-sm text-gray-400">Nobody matches.</p>
              ) : (
                people.map((u) => (
                  <label key={u._id} className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer">
                    <input type="checkbox" checked={members.has(u._id)} onChange={() => toggle(u._id)} className="w-4 h-4 rounded" style={{ accentColor: themeColor }} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-gray-800 dark:text-gray-100 truncate">{u.name}</span>
                      {u.email && <span className="block text-xs text-gray-500 dark:text-gray-400 truncate">{u.email}</span>}
                    </span>
                    {u.kind === 'placeholder' && <Badge tone="warning">Placeholder</Badge>}
                    {u.invited && <Badge tone="info">Invited</Badge>}
                    {!u.isActive && <Badge>Inactive</Badge>}
                  </label>
                ))
              )}
            </div>
          </div>
        </Field>
      </div>
    </Drawer>
  );
}

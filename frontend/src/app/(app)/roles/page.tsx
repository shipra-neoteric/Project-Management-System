'use client';

import { Globe2, KeyRound, Lock, Pencil, Plus, Save, ShieldCheck, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { Alert, EmptyState, PageLoader } from '@/components/ui/Feedback';
import { Field, inputCls } from '@/components/ui/Field';
import { Card, FilterTabs, Page, PageHeader, rowCls, tableCls, tbodyCls, td, th, theadCls } from '@/components/ui/Layout';
import { ThemedSelect } from '@/components/ui/ThemedSelect';
import { AdminGate } from '@/features/AdminGate';
import { useGlobalRoles, useRoles } from '@/features/queries';
import { confirmDanger, toastError, toastSuccess } from '@/lib/alerts';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ROLE_PERMISSION_GROUPS } from '@/lib/permissions';
import { roleBadge } from '@/lib/status';
import { useTheme } from '@/lib/theme';
import type { GlobalPermission, GlobalRole, ProjectPermission, Role } from '@/lib/types';

type Section = 'project' | 'global';

export default function RolesPage() {
  return (
    <AdminGate>
      <RolesContent />
    </AdminGate>
  );
}

function RolesContent() {
  const [section, setSection] = useState<Section>('project');
  return (
    <Page>
      <PageHeader
        title="Roles & permissions"
        subtitle="Project roles decide what members can do inside a project. Global roles grant organisation-wide rights such as creating projects."
      />
      <FilterTabs<Section>
        value={section}
        onChange={setSection}
        tabs={[
          { key: 'project', label: 'Project roles', icon: KeyRound },
          { key: 'global', label: 'Global roles', icon: Globe2 },
        ]}
      />
      {section === 'project' ? <ProjectRoles /> : <GlobalRoles />}
    </Page>
  );
}

// ---- Project roles: permission matrix ------------------------------------------------------------

function ProjectRoles() {
  const { data, isLoading, error, create, update, remove } = useRoles();
  const { themeColor } = useTheme();
  /** Unsaved permission sets per role id. */
  const [drafts, setDrafts] = useState<Record<string, Set<ProjectPermission>>>({});
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Role | null>(null);

  const roles = useMemo(() => data?.roles ?? [], [data]);
  const permissions = useMemo(() => data?.permissions ?? [], [data]);
  const groups = useMemo(
    () => ROLE_PERMISSION_GROUPS.map((g) => ({ group: g, items: permissions.filter((p) => (p.group ?? 'Project') === g) })).filter((g) => g.items.length),
    [permissions],
  );

  if (isLoading) return <PageLoader />;
  if (error) return <Alert>{errorMessage(error)}</Alert>;

  const current = (r: Role) => drafts[r._id] ?? new Set(r.permissions);
  const dirty = (r: Role) => {
    const d = drafts[r._id];
    if (!d) return false;
    return d.size !== r.permissions.length || r.permissions.some((p) => !d.has(p));
  };
  const toggle = (r: Role, perm: ProjectPermission) => {
    if (perm === 'view_project') return;
    const next = new Set(current(r));
    if (next.has(perm)) next.delete(perm);
    else next.add(perm);
    setDrafts((d) => ({ ...d, [r._id]: next }));
  };
  const discard = (r: Role) =>
    setDrafts((d) => {
      const { [r._id]: _drop, ...rest } = d;
      return rest;
    });
  const save = async (r: Role) => {
    try {
      await update.mutateAsync({ id: r._id, permissions: [...current(r)] });
      discard(r);
      void toastSuccess(`${r.name} saved`);
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };
  const onDelete = async (r: Role) => {
    if (!(await confirmDanger(`Delete the role "${r.name}"?`, 'Projects must not use it any more.'))) return;
    try {
      await remove.mutateAsync(r._id);
      discard(r);
      void toastSuccess('Role deleted');
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  return (
    <>
      <Card
        title="Project roles"
        icon={ShieldCheck}
        actions={
          <Button size="sm" variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New role
          </Button>
        }
      >
        <p className="px-5 pt-4 text-sm text-gray-500 dark:text-gray-400">
          Tick what each role may do. Project owners and administrators always have every permission; “View the project” is always on.
        </p>
        <div className="overflow-x-auto custom-scrollbar p-2 sm:p-4">
          <table className={cn(tableCls, 'text-sm')}>
            <thead className={theadCls}>
              <tr>
                <th className={cn(th, 'sticky left-0 bg-gray-50 dark:bg-gray-900 z-10 min-w-64')}>Permission</th>
                {roles.map((r) => {
                  const badge = roleBadge(r.key ?? r._id, r.name);
                  return (
                    <th key={r._id} className={cn(th, 'text-center min-w-36 normal-case tracking-normal')}>
                      <div className="flex flex-col items-center gap-1.5">
                        <Badge tone={badge.tone}>{r.name}</Badge>
                        <div className="flex items-center gap-0.5">
                          <IconButton icon={Pencil} label={`Rename ${r.name}`} tone="edit" onClick={() => setRenaming(r)} />
                          {r.key ? (
                            <span title="Built-in roles cannot be deleted" className="p-1.5 text-gray-300 dark:text-gray-600">
                              <Lock className="w-4 h-4" />
                            </span>
                          ) : (
                            <IconButton icon={Trash2} label={`Delete ${r.name}`} tone="delete" onClick={() => onDelete(r)} />
                          )}
                        </div>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className={tbodyCls}>
              {groups.map((g) => (
                <GroupRows key={g.group} label={g.group} colSpan={roles.length + 1}>
                  {g.items.map((p) => (
                    <tr key={p.key} className={rowCls}>
                      <td className={cn(td, 'sticky left-0 bg-white dark:bg-gray-800 z-10 !py-2.5 text-gray-700 dark:text-gray-200')}>{p.label}</td>
                      {roles.map((r) => {
                        const on = current(r).has(p.key);
                        const locked = p.key === 'view_project';
                        return (
                          <td key={r._id} className={cn(td, '!py-2.5 text-center')}>
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={locked}
                              onChange={() => toggle(r, p.key)}
                              aria-label={`${r.name}: ${p.label}`}
                              className="w-4 h-4 rounded cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                              style={{ accentColor: themeColor }}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </GroupRows>
              ))}
              <tr>
                <td className={cn(td, 'sticky left-0 bg-white dark:bg-gray-800 z-10 text-xs text-gray-400')}>Changes</td>
                {roles.map((r) => (
                  <td key={r._id} className={cn(td, 'text-center')}>
                    {dirty(r) ? (
                      <div className="flex items-center justify-center gap-1">
                        <Button size="sm" variant="primary" icon={Save} loading={update.isPending && update.variables?.id === r._id} onClick={() => save(r)}>
                          Save
                        </Button>
                        <IconButton icon={Undo2} label="Discard changes" onClick={() => discard(r)} />
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">{current(r).size} on</span>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <NewRoleDrawer
        open={creating}
        roles={roles}
        onClose={() => setCreating(false)}
        onCreate={async (name, from) => {
          const base = roles.find((r) => r._id === from);
          try {
            await create.mutateAsync({ name, permissions: base ? base.permissions : ['view_project'] });
            void toastSuccess('Role created — adjust its permissions in the matrix');
            setCreating(false);
          } catch (err) {
            void toastError(errorMessage(err));
          }
        }}
        saving={create.isPending}
      />
      <RenameDrawer
        role={renaming}
        onClose={() => setRenaming(null)}
        saving={update.isPending}
        onSave={async (name) => {
          if (!renaming) return;
          try {
            await update.mutateAsync({ id: renaming._id, name });
            void toastSuccess('Role renamed');
            setRenaming(null);
          } catch (err) {
            void toastError(errorMessage(err));
          }
        }}
      />
    </>
  );
}

function GroupRows({ label, colSpan, children }: { label: string; colSpan: number; children: React.ReactNode }) {
  return (
    <>
      <tr className="bg-gray-50/70 dark:bg-gray-900/50">
        <td colSpan={colSpan} className="px-3 sm:px-6 py-2 text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest">
          {label}
        </td>
      </tr>
      {children}
    </>
  );
}

function NewRoleDrawer({
  open,
  roles,
  onClose,
  onCreate,
  saving,
}: {
  open: boolean;
  roles: Role[];
  onClose: () => void;
  onCreate: (name: string, from: string) => void;
  saving: boolean;
}) {
  const [name, setName] = useState('');
  const [from, setFrom] = useState('');
  useEffect(() => {
    if (open) {
      setName('');
      setFrom(roles.find((r) => r.key === 'member')?._id ?? '');
    }
  }, [open, roles]);
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New project role"
      subtitle="e.g. Site engineer, Client, Accountant"
      icon={KeyRound}
      width="md"
      footer={
        <>
          <Button inDrawer onClick={onClose}>
            Cancel
          </Button>
          <Button inDrawer variant="primary" disabled={!name.trim()} loading={saving} onClick={() => onCreate(name.trim(), from)}>
            Create role
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Name" htmlFor="role-name" required>
          <input id="role-name" className={inputCls} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Start from" hint="Copies that role's permissions; you can change them afterwards.">
          <ThemedSelect
            options={[{ value: '', label: 'Nothing (view only)' }, ...roles.map((r) => ({ value: r._id, label: r.name, description: `${r.permissions.length} permissions` }))]}
            value={from}
            onChange={setFrom}
          />
        </Field>
      </div>
    </Drawer>
  );
}

function RenameDrawer({ role, onClose, onSave, saving }: { role: Role | null; onClose: () => void; onSave: (name: string) => void; saving: boolean }) {
  const [name, setName] = useState('');
  useEffect(() => setName(role?.name ?? ''), [role]);
  return (
    <Drawer
      open={!!role}
      onClose={onClose}
      title="Rename role"
      subtitle={role?.key ? 'Built-in role — the name changes everywhere it is shown' : undefined}
      icon={Pencil}
      width="md"
      footer={
        <>
          <Button inDrawer onClick={onClose}>
            Cancel
          </Button>
          <Button inDrawer variant="primary" disabled={!name.trim() || name.trim() === role?.name} loading={saving} onClick={() => onSave(name.trim())}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Name" htmlFor="rename-role" required>
        <input id="rename-role" className={inputCls} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
    </Drawer>
  );
}

// ---- Global roles --------------------------------------------------------------------------------

function GlobalRoles() {
  const { data, isLoading, error, create, update, remove } = useGlobalRoles();
  const [editing, setEditing] = useState<GlobalRole | 'new' | null>(null);

  if (isLoading) return <PageLoader />;
  if (error) return <Alert>{errorMessage(error)}</Alert>;
  const roles = data?.roles ?? [];
  const permissions = data?.permissions ?? [];
  const label = new Map(permissions.map((p) => [p.key, p.label]));

  const onDelete = async (r: GlobalRole) => {
    if (!(await confirmDanger(`Delete the global role "${r.name}"?`, 'People who had it lose these rights.'))) return;
    try {
      await remove.mutateAsync(r._id);
      void toastSuccess('Global role deleted');
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  return (
    <>
      <Card
        title="Global roles"
        icon={Globe2}
        actions={
          <Button size="sm" variant="primary" icon={Plus} onClick={() => setEditing('new')}>
            New global role
          </Button>
        }
      >
        <p className="px-5 pt-4 text-sm text-gray-500 dark:text-gray-400">
          Give these to people on the Users page. A role that applies to everyone is granted to every signed-in user automatically. Administrators have all rights.
        </p>
        {roles.length === 0 ? (
          <EmptyState icon={Globe2} title="No global roles yet" compact />
        ) : (
          <div className="overflow-x-auto custom-scrollbar mt-3">
            <table className={tableCls}>
              <thead className={theadCls}>
                <tr>
                  <th className={th}>Name</th>
                  <th className={th}>Permissions</th>
                  <th className={`${th} hidden sm:table-cell`}>Applies to</th>
                  <th className={`${th} text-right w-24`}>Actions</th>
                </tr>
              </thead>
              <tbody className={tbodyCls}>
                {roles.map((r) => (
                  <tr key={r._id} className={rowCls}>
                    <td className={`${td} text-sm font-medium text-gray-900 dark:text-white whitespace-nowrap`}>{r.name}</td>
                    <td className={td}>
                      <div className="flex flex-wrap gap-1.5">
                        {r.permissions.length ? r.permissions.map((p) => <Badge key={p}>{label.get(p) ?? p}</Badge>) : <span className="text-sm text-gray-400">None</span>}
                      </div>
                    </td>
                    <td className={`${td} hidden sm:table-cell`}>{r.isDefault ? <Badge tone="info">Everyone</Badge> : <span className="text-sm text-gray-500 dark:text-gray-400">Assigned people</span>}</td>
                    <td className={`${td} text-right whitespace-nowrap`}>
                      <IconButton icon={Pencil} label="Edit" tone="edit" onClick={() => setEditing(r)} />
                      <IconButton icon={Trash2} label="Delete" tone="delete" onClick={() => onDelete(r)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <GlobalRoleDrawer
        role={editing}
        permissions={permissions}
        saving={create.isPending || update.isPending}
        onClose={() => setEditing(null)}
        onSave={async (body) => {
          try {
            if (editing === 'new') await create.mutateAsync(body);
            else if (editing) await update.mutateAsync({ id: editing._id, ...body });
            void toastSuccess(editing === 'new' ? 'Global role created' : 'Global role saved');
            setEditing(null);
          } catch (err) {
            void toastError(errorMessage(err));
          }
        }}
      />
    </>
  );
}

function GlobalRoleDrawer({
  role,
  permissions,
  saving,
  onClose,
  onSave,
}: {
  role: GlobalRole | 'new' | null;
  permissions: { key: GlobalPermission; label: string }[];
  saving: boolean;
  onClose: () => void;
  onSave: (body: { name: string; permissions: GlobalPermission[]; isDefault: boolean }) => void;
}) {
  const { themeColor } = useTheme();
  const [name, setName] = useState('');
  const [perms, setPerms] = useState<Set<GlobalPermission>>(new Set());
  const [isDefault, setIsDefault] = useState(false);
  useEffect(() => {
    const r = role && role !== 'new' ? role : null;
    setName(r?.name ?? '');
    setPerms(new Set(r?.permissions ?? []));
    setIsDefault(r?.isDefault ?? false);
  }, [role]);

  const toggle = (p: GlobalPermission) =>
    setPerms((s) => {
      const next = new Set(s);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  return (
    <Drawer
      open={!!role}
      onClose={onClose}
      title={role === 'new' ? 'New global role' : 'Edit global role'}
      subtitle="Organisation-wide rights"
      icon={Globe2}
      width="md"
      footer={
        <>
          <Button inDrawer onClick={onClose}>
            Cancel
          </Button>
          <Button inDrawer variant="primary" disabled={!name.trim()} loading={saving} onClick={() => onSave({ name: name.trim(), permissions: [...perms], isDefault })}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Name" htmlFor="global-role-name" required>
          <input id="global-role-name" className={inputCls} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Permissions">
          <div className="space-y-1 rounded-md border border-gray-200 dark:border-gray-700 p-2">
            {permissions.map((p) => (
              <label key={p.key} className="flex items-start gap-3 px-2 py-2 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer">
                <input type="checkbox" checked={perms.has(p.key)} onChange={() => toggle(p.key)} className="mt-0.5 w-4 h-4 rounded" style={{ accentColor: themeColor }} />
                <span className="text-sm text-gray-700 dark:text-gray-200">{p.label}</span>
              </label>
            ))}
          </div>
        </Field>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="mt-0.5 w-4 h-4 rounded" style={{ accentColor: themeColor }} />
          <span>
            <span className="block text-sm font-medium text-gray-800 dark:text-gray-100">Applies to everyone</span>
            <span className="block text-xs text-gray-500 dark:text-gray-400">Every signed-in user gets these rights without being assigned the role.</span>
          </span>
        </label>
      </div>
    </Drawer>
  );
}

'use client';

import { ShieldCheck, UserCheck, Users, UserX } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, EmptyState, PageLoader } from '@/components/ui/Feedback';
import { KpiCard, KpiGrid, Page, PageHeader, rowCls, SearchInput, tableCls, tbodyCls, td, th, theadCls } from '@/components/ui/Layout';
import { ThemedSelect } from '@/components/ui/ThemedSelect';
import { AdminGate } from '@/features/AdminGate';
import { useUpdateUser, useUsers } from '@/features/queries';
import { confirmDanger, toastError, toastSuccess } from '@/lib/alerts';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { AppRole, User } from '@/lib/types';

const ROLE_OPTIONS = [
  { value: 'Admin', label: 'Admin', description: 'Full access to every project and settings' },
  { value: 'User', label: 'User', description: 'Access to own and shared projects' },
];

export default function UsersPage() {
  return (
    <AdminGate>
      <UsersContent />
    </AdminGate>
  );
}

function UsersContent() {
  const { user: me } = useAuth();
  const { data: users = [], isLoading, error } = useUsers();
  const update = useUpdateUser();
  const [search, setSearch] = useState('');

  const visible = users.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(search.trim().toLowerCase()));

  const change = async (u: User, body: { role?: AppRole; isActive?: boolean }, message: string) => {
    if (body.isActive === false && !(await confirmDanger(`Deactivate ${u.name}?`, 'They will no longer be able to sign in.', 'Deactivate'))) return;
    try {
      await update.mutateAsync({ id: u._id, ...body });
      void toastSuccess(message);
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  return (
    <Page>
      <PageHeader title="Users" subtitle="Everyone who has registered. New people sign up themselves on the register page." />
      <KpiGrid>
        <KpiCard label="Total users" value={users.length} icon={Users} iconColor="text-blue-500" />
        <KpiCard label="Admins" value={users.filter((u) => u.role === 'Admin').length} icon={ShieldCheck} iconColor="text-purple-500" />
        <KpiCard label="Active" value={users.filter((u) => u.isActive).length} icon={UserCheck} iconColor="text-green-500" />
        <KpiCard label="Deactivated" value={users.filter((u) => !u.isActive).length} icon={UserX} iconColor="text-red-500" />
      </KpiGrid>
      <SearchInput value={search} onChange={setSearch} placeholder="Search users…" />
      {error && <Alert>{errorMessage(error)}</Alert>}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        {isLoading ? (
          <PageLoader />
        ) : visible.length === 0 ? (
          <EmptyState icon={Users} title="No users found" message="Try a different search" />
        ) : (
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead className={theadCls}>
                <tr>
                  <th className={th}>User</th>
                  <th className={th}>Role</th>
                  <th className={th}>Status</th>
                  <th className={`${th} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody className={tbodyCls}>
                {visible.map((u) => {
                  const self = u._id === me?._id;
                  return (
                    <tr key={u._id} className={rowCls}>
                      <td className={td}>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {u.name} {self && <span className="text-xs text-gray-400">(you)</span>}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{u.email}</p>
                      </td>
                      <td className={`${td} w-48`}>
                        {self ? (
                          <Badge tone="purple">{u.role}</Badge>
                        ) : (
                          <ThemedSelect compact options={ROLE_OPTIONS} value={u.role} onChange={(v) => change(u, { role: v as AppRole }, 'Role updated')} />
                        )}
                      </td>
                      <td className={td}>
                        <Badge tone={u.isActive ? 'success' : 'danger'} dot>
                          {u.isActive ? 'Active' : 'Deactivated'}
                        </Badge>
                      </td>
                      <td className={`${td} text-right`}>
                        {!self &&
                          (u.isActive ? (
                            <Button size="sm" variant="danger" onClick={() => change(u, { isActive: false }, 'User deactivated')}>
                              Deactivate
                            </Button>
                          ) : (
                            <Button size="sm" onClick={() => change(u, { isActive: true }, 'User reactivated')}>
                              Reactivate
                            </Button>
                          ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Page>
  );
}

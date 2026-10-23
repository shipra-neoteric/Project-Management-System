'use client';

import { BellOff, CheckCheck } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Alert, EmptyState, PageLoader } from '@/components/ui/Feedback';
import { FilterTabs, Page, PageHeader } from '@/components/ui/Layout';
import { NotificationItem, useOpenNotification } from '@/components/layout/Notifications';
import { useMarkRead, useNotifications } from '@/features/queries';
import { errorMessage } from '@/lib/api';

export default function NotificationsPage() {
  const [filter, setFilter] = useState<'unread' | 'all'>('unread');
  const list = useNotifications(filter === 'unread');
  const markRead = useMarkRead();
  const open = useOpenNotification();
  const unread = list.data?.unreadCount ?? 0;

  return (
    <Page>
      <PageHeader
        title="Notifications"
        subtitle="Mentions, assignments and changes on tasks you watch"
        actions={
          <Button icon={CheckCheck} disabled={!unread} loading={markRead.isPending} onClick={() => markRead.mutate({ all: true })}>
            Mark all as read
          </Button>
        }
      />
      <FilterTabs<'unread' | 'all'>
        value={filter}
        onChange={setFilter}
        tabs={[
          { key: 'unread', label: 'Unread', count: unread },
          { key: 'all', label: 'All' },
        ]}
      />
      {list.error && <Alert>{errorMessage(list.error)}</Alert>}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        {list.isLoading ? (
          <PageLoader />
        ) : !list.data?.notifications.length ? (
          <EmptyState icon={BellOff} title={filter === 'unread' ? 'No unread notifications' : 'No notifications yet'} message="You'll be notified when someone mentions you, assigns you a task or changes a task you watch." />
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {list.data.notifications.map((n) => (
              <NotificationItem key={n._id} n={n} onOpen={open} />
            ))}
          </div>
        )}
      </div>
    </Page>
  );
}

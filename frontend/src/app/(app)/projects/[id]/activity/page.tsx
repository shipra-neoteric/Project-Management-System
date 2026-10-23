'use client';

import { Activity } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ActivityFeed } from '@/components/activity/ActivityFeed';
import { Alert, EmptyState, PageLoader } from '@/components/ui/Feedback';
import { Card, FilterTabs } from '@/components/ui/Layout';
import { useWorkspace } from '@/features/project-context';
import { useProjectActivity } from '@/features/queries';
import { errorMessage } from '@/lib/api';
import type { JournalEntry } from '@/lib/types';

type Filter = 'all' | 'comment' | 'change' | 'files';

export default function ProjectActivityPage() {
  const { id } = useParams<{ id: string }>();
  const { openTask } = useWorkspace();
  const activity = useProjectActivity(id);
  const [filter, setFilter] = useState<Filter>('all');

  const match = (e: JournalEntry) =>
    filter === 'all' ? true : filter === 'files' ? e.kind === 'attachment' : filter === 'change' ? e.kind === 'change' || e.kind === 'created' || e.kind === 'deleted' : e.kind === 'comment';
  const entries = (activity.data ?? []).filter(match);

  return (
    <div className="space-y-3">
      <FilterTabs<Filter>
        value={filter}
        onChange={setFilter}
        tabs={[
          { key: 'all', label: 'Everything' },
          { key: 'comment', label: 'Comments' },
          { key: 'change', label: 'Changes' },
          { key: 'files', label: 'Files' },
        ]}
      />
      {activity.error && <Alert>{errorMessage(activity.error)}</Alert>}
      <Card title="Latest activity (newest first)" icon={Activity}>
        <div className="p-5">
          {activity.isLoading ? (
            <PageLoader />
          ) : entries.length === 0 ? (
            <EmptyState icon={Activity} title="Nothing here yet" message="Changes, comments and files on this project's tasks show up here." compact />
          ) : (
            <ActivityFeed entries={entries} showTask onOpenTask={openTask} />
          )}
        </div>
      </Card>
    </div>
  );
}

'use client';

import { ArrowRight, MessageSquare, Paperclip, Pencil, PlusCircle, Trash2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '@/components/ui/TaskBits';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { fmtDateTime } from '@/lib/dates';
import type { JournalEntry, UserRef } from '@/lib/types';
import { CommentText, MentionTextarea } from './MentionTextarea';

const ICONS = { created: PlusCircle, change: Pencil, comment: MessageSquare, deleted: XCircle, attachment: Paperclip };
const VERB = { created: 'created', change: 'updated', comment: 'commented on', deleted: 'deleted', attachment: 'updated files of' };

interface ActivityFeedProps {
  entries: JournalEntry[];
  /** Show which task each entry belongs to (project-wide stream). */
  showTask?: boolean;
  onOpenTask?: (taskId: string) => void;
  currentUserId?: string;
  canModerate?: boolean;
  people?: UserRef[];
  onEditComment?: (id: string, text: string) => Promise<void>;
  onDeleteComment?: (id: string) => Promise<void>;
}

/** Nexora timeline (§6.12) of task history and comments. */
export function ActivityFeed({ entries, showTask, onOpenTask, currentUserId, canModerate, people = [], onEditComment, onDeleteComment }: ActivityFeedProps) {
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  if (!entries.length) return <p className="text-sm text-gray-400 dark:text-gray-500 py-4">No activity yet.</p>;

  return (
    <ol className="space-y-4">
      {entries.map((e) => {
        const Icon = ICONS[e.kind] ?? Pencil;
        const own = !!currentUserId && e.user?._id === currentUserId;
        return (
          <li key={e._id} className="flex gap-3">
            {e.kind === 'comment' ? (
              <Avatar name={e.user?.name ?? '?'} />
            ) : (
              <div className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center shrink-0">
                <Icon className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-900 dark:text-white">
                <span className="font-medium">{e.user?.name ?? 'Someone'}</span>{' '}
                <span className="text-gray-500 dark:text-gray-400">{VERB[e.kind]}</span>{' '}
                {showTask && e.taskName ? (
                  e.task && e.kind !== 'deleted' && onOpenTask ? (
                    <button type="button" onClick={() => onOpenTask(e.task!)} className="font-medium text-blue-600 dark:text-blue-400 hover:underline">
                      {e.taskName}
                    </button>
                  ) : (
                    <span className="font-medium">{e.taskName}</span>
                  )
                ) : e.kind !== 'comment' ? (
                  <span className="text-gray-500 dark:text-gray-400">this task</span>
                ) : null}
              </p>
              <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
                <span>{fmtDateTime(e.createdAt)}</span>
                {e.editedAt && <span>· edited</span>}
                {e.kind === 'comment' && onEditComment && own && editing?.id !== e._id && (
                  <button type="button" className="hover:text-blue-600" onClick={() => setEditing({ id: e._id, text: e.text })}>
                    Edit
                  </button>
                )}
                {e.kind === 'comment' && onDeleteComment && (own || canModerate) && (
                  <button type="button" className="hover:text-red-500 inline-flex items-center gap-0.5" onClick={() => onDeleteComment(e._id)} aria-label="Delete comment">
                    <Trash2 className="w-3 h-3" /> Delete
                  </button>
                )}
              </div>
              {e.kind === 'comment' &&
                (editing?.id === e._id ? (
                  <div className="mt-2 space-y-2">
                    <MentionTextarea value={editing.text} onChange={(text) => setEditing({ id: e._id, text })} people={people} rows={3} autoFocus />
                    <div className="flex gap-2">
                      <Button inDrawer size="sm" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                      <Button
                        inDrawer
                        size="sm"
                        variant="primary"
                        disabled={!editing.text.trim()}
                        onClick={async () => {
                          await onEditComment?.(e._id, editing.text);
                          setEditing(null);
                        }}
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-1.5 p-3 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-700">
                    <CommentText text={e.text} />
                  </div>
                ))}
              {e.kind !== 'comment' && e.text && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{e.text}</p>}
              {e.changes.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {e.changes.map((c, i) => (
                    <li key={i} className="text-xs text-gray-600 dark:text-gray-300 flex flex-wrap items-center gap-1">
                      <span className="font-semibold">{c.label}</span>
                      <span className={cn('line-through text-gray-400', !c.from && 'hidden')}>{c.from}</span>
                      <ArrowRight className="w-3 h-3 text-gray-400" />
                      <span>{c.to || '—'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

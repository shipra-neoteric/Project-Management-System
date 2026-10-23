'use client';

import { Download, FileText, Loader2, Send, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { ActivityFeed } from '@/components/activity/ActivityFeed';
import { MentionTextarea } from '@/components/activity/MentionTextarea';
import { Button } from '@/components/ui/Button';
import { Alert, PageLoader } from '@/components/ui/Feedback';
import { useAttachments, useCommentMutations, useTaskActivity } from '@/features/queries';
import { confirmDanger, toastError } from '@/lib/alerts';
import { apiDownload, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { fmtDateTime } from '@/lib/dates';
import { useTheme } from '@/lib/theme';
import type { UserRef } from '@/lib/types';

/** Comment box + full history of a task. */
export function TaskActivityPanel({ projectId, taskId, people, canComment, canModerate }: { projectId: string; taskId: string; people: UserRef[]; canComment: boolean; canModerate: boolean }) {
  const { user } = useAuth();
  const activity = useTaskActivity(projectId, taskId);
  const comments = useCommentMutations(projectId, taskId);
  const [text, setText] = useState('');

  const post = async () => {
    if (!text.trim()) return;
    try {
      await comments.add.mutateAsync(text.trim());
      setText('');
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      {canComment && (
        <div className="space-y-2">
          <MentionTextarea value={text} onChange={setText} people={people} placeholder="Write a comment… type @ to mention someone" onSubmit={post} />
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Ctrl + Enter to post · mentioned people are notified</span>
            <Button inDrawer size="sm" variant="primary" icon={Send} loading={comments.add.isPending} disabled={!text.trim()} onClick={post}>
              Comment
            </Button>
          </div>
        </div>
      )}
      {activity.isLoading ? (
        <PageLoader />
      ) : activity.error ? (
        <Alert>{errorMessage(activity.error)}</Alert>
      ) : (
        <ActivityFeed
          entries={[...(activity.data?.activity ?? [])].reverse()}
          currentUserId={user?._id}
          canModerate={canModerate}
          people={people}
          onEditComment={async (id, value) => {
            try {
              await comments.edit.mutateAsync({ id, text: value });
            } catch (err) {
              void toastError(errorMessage(err));
            }
          }}
          onDeleteComment={async (id) => {
            if (!(await confirmDanger('Delete this comment?'))) return;
            try {
              await comments.remove.mutateAsync(id);
            } catch (err) {
              void toastError(errorMessage(err));
            }
          }}
        />
      )}
    </div>
  );
}

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Upload zone (Nexora §6.14) + file list for a task. */
export function TaskFilesPanel({ projectId, taskId, canEdit, canModerate }: { projectId: string; taskId: string; canEdit: boolean; canModerate: boolean }) {
  const { user } = useAuth();
  const { themeColor } = useTheme();
  const files = useAttachments(projectId, taskId);
  const input = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const uploadAll = async (list: FileList | null) => {
    for (const file of Array.from(list ?? [])) {
      if (file.size > 10 * 1024 * 1024) {
        void toastError(`${file.name} is larger than 10 MB`);
        continue;
      }
      try {
        await files.upload.mutateAsync(file);
      } catch (err) {
        void toastError(errorMessage(err));
      }
    }
  };

  return (
    <div className="space-y-5">
      {canEdit && (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void uploadAll(e.dataTransfer.files);
          }}
          className={cn(
            'flex flex-col items-center justify-center gap-2 p-5 rounded-md border-2 border-dashed cursor-pointer transition-colors',
            dragOver ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/10' : 'border-gray-300 dark:border-gray-600 hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-900/10',
          )}
        >
          <input ref={input} type="file" multiple className="hidden" onChange={(e) => void uploadAll(e.target.files).then(() => input.current && (input.current.value = ''))} />
          {files.upload.isPending ? <Loader2 className="w-8 h-8 animate-spin text-gray-400" /> : <Upload className="w-8 h-8 text-gray-400" />}
          <p className="text-sm text-gray-500 dark:text-gray-400">{files.upload.isPending ? 'Uploading…' : 'Click or drag files here to upload'}</p>
          <p className="text-[11px] text-gray-400">Any file type · max 10 MB each</p>
        </label>
      )}
      {files.isLoading ? (
        <PageLoader />
      ) : !files.data?.length ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">No files attached.</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg">
          {files.data.map((f) => (
            <li key={f._id} className="flex items-center gap-3 px-3 py-2.5">
              <FileText className="w-6 h-6 shrink-0" style={{ color: themeColor }} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{f.filename}</p>
                <p className="text-xs text-gray-400">
                  {fmtSize(f.size)} · {f.uploadedBy?.name ?? 'Unknown'} · {fmtDateTime(f.createdAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => apiDownload(files.downloadUrl(f._id), f.filename).catch((err) => toastError(errorMessage(err)))}
                className="p-1.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                title="Download"
                aria-label={`Download ${f.filename}`}
              >
                <Download className="w-4 h-4" />
              </button>
              {canEdit && (f.uploadedBy?._id === user?._id || canModerate) && (
                <button
                  type="button"
                  onClick={async () => {
                    if (!(await confirmDanger(`Delete ${f.filename}?`))) return;
                    try {
                      await files.remove.mutateAsync(f._id);
                    } catch (err) {
                      void toastError(errorMessage(err));
                    }
                  }}
                  className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                  title="Delete"
                  aria-label={`Delete ${f.filename}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

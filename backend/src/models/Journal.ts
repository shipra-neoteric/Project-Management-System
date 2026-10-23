import { Schema, model, type InferSchemaType } from 'mongoose';

export const JOURNAL_KINDS = ['created', 'change', 'comment', 'deleted', 'attachment'] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];

const changeSchema = new Schema(
  {
    field: { type: String, required: true },
    label: { type: String, required: true },
    from: { type: String, default: '' },
    to: { type: String, default: '' },
  },
  { _id: false },
);

/**
 * History of a task: who created/changed/commented/attached what and when.
 * Values are stored as display strings, so history stays readable even after
 * the referenced status/user/resource is renamed or deleted.
 */
const journalSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    task: { type: Schema.Types.ObjectId, default: null },
    taskName: { type: String, default: '' },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: JOURNAL_KINDS, required: true },
    text: { type: String, default: '', maxlength: 10_000 },
    changes: { type: [changeSchema], default: [] },
    mentions: { type: [Schema.Types.ObjectId], default: [] },
    editedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
journalSchema.index({ project: 1, createdAt: -1 });
journalSchema.index({ task: 1, createdAt: 1 });

export type JournalAttrs = InferSchemaType<typeof journalSchema>;
export const Journal = model('Journal', journalSchema);

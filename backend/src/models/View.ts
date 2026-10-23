import { Schema, model } from 'mongoose';

export const VIEW_KINDS = ['gantt', 'table', 'board', 'calendar', 'projects'] as const;

/**
 * A saved view of a project's tasks: filters, sorting, grouping and columns.
 * Private views belong to their owner; public views are shared with the whole project.
 */
const viewSchema = new Schema(
  {
    /** null for organisation-level views (kind "projects" = saved project lists). */
    project: { type: Schema.Types.ObjectId, ref: 'Project', default: null, index: true },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    kind: { type: String, enum: VIEW_KINDS, required: true },
    isPublic: { type: Boolean, default: false },
    config: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

export const View = model('View', viewSchema);

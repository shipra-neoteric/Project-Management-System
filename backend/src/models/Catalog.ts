import { Schema, model, type InferSchemaType } from 'mongoose';

/** Organisation-wide task types (Task, Milestone, Bug, …). */
const taskTypeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 40 },
    color: { type: String, required: true, match: /^#[0-9a-fA-F]{6}$/ },
    position: { type: Number, default: 0 },
    isDefault: { type: Boolean, default: false },
    isMilestone: { type: Boolean, default: false },
    /** Optional built-in fields and custom field ids hidden on the task form for this type. */
    hiddenFields: { type: [String], default: [] },
  },
  { timestamps: true },
);

/** Organisation-wide task statuses (New, In progress, Closed, …). */
const statusSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 40 },
    color: { type: String, required: true, match: /^#[0-9a-fA-F]{6}$/ },
    position: { type: Number, default: 0 },
    isDefault: { type: Boolean, default: false },
    /** Closed statuses count as done: the task is set to 100 % complete. */
    isClosed: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type TaskTypeAttrs = InferSchemaType<typeof taskTypeSchema>;
export type StatusAttrs = InferSchemaType<typeof statusSchema>;
export const TaskType = model('TaskType', taskTypeSchema);
export const Status = model('Status', statusSchema);

export const PRIORITIES = ['low', 'normal', 'high', 'immediate'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const DEFAULT_TYPES = [
  { name: 'Task', color: '#3b82f6', isDefault: true },
  { name: 'Milestone', color: '#a855f7', isMilestone: true },
  { name: 'Phase', color: '#14b8a6' },
  { name: 'Feature', color: '#22c55e' },
  { name: 'Bug', color: '#ef4444' },
  { name: 'Risk', color: '#f59e0b' },
];

export const DEFAULT_STATUSES = [
  { name: 'New', color: '#6b7280', isDefault: true },
  { name: 'In progress', color: '#3b82f6' },
  { name: 'On hold', color: '#f59e0b' },
  { name: 'In review', color: '#8b5cf6' },
  { name: 'Closed', color: '#22c55e', isClosed: true },
  { name: 'Rejected', color: '#ef4444', isClosed: true },
];

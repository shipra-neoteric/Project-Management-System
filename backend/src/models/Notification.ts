import { Schema, model } from 'mongoose';

/** Why someone was notified, most important first (only the top reason is stored per event). */
export const NOTIFICATION_REASONS = ['mentioned', 'assigned', 'accountable', 'commented', 'updated', 'watched'] as const;
export type NotificationReason = (typeof NOTIFICATION_REASONS)[number];

const notificationSchema = new Schema(
  {
    recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    projectName: { type: String, default: '' },
    task: { type: Schema.Types.ObjectId, default: null },
    taskName: { type: String, default: '' },
    journal: { type: Schema.Types.ObjectId, ref: 'Journal', default: null },
    reason: { type: String, enum: NOTIFICATION_REASONS, required: true },
    summary: { type: String, default: '' },
    read: { type: Boolean, default: false },
  },
  { timestamps: true },
);
notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });

export const Notification = model('Notification', notificationSchema);

import { Schema, model } from 'mongoose';

/**
 * Marker for a date reminder that was already sent, so the hourly job never repeats it:
 * one per user + task + kind + date ("start"/"finish" alerts use the task date, "overdue" the
 * finish date, "digest" the day it was emailed). Old markers expire after 180 days.
 */
const reminderLogSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    task: { type: Schema.Types.ObjectId, default: null },
    kind: { type: String, enum: ['start', 'finish', 'overdue', 'digest'], required: true },
    key: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 180 },
  },
  { versionKey: false },
);
reminderLogSchema.index({ user: 1, task: 1, kind: 1, key: 1 }, { unique: true });

export const ReminderLog = model('ReminderLog', reminderLogSchema);

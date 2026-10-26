import { Schema, model, type HydratedDocument, type InferSchemaType, type Types } from 'mongoose';

export const MEETING_STATUSES = ['draft', 'open', 'closed'] as const;
export const RECURRENCE_FREQUENCIES = ['weekly', 'biweekly', 'monthly'] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

const participantSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** When the invitation was sent (null = not invited yet). */
    invitedAt: { type: Date, default: null },
    /** null = not recorded yet. */
    attended: { type: Boolean, default: null },
  },
  { _id: false },
);

const agendaItemSchema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  /** Rich text (sanitised HTML). */
  notes: { type: String, default: '', maxlength: 20000 },
  durationMinutes: { type: Number, default: 10, min: 0, max: 600 },
  presenter: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  /** A task this item is about. */
  task: { type: Schema.Types.ObjectId, default: null },
  /** Rich text: what was decided. */
  outcome: { type: String, default: '', maxlength: 20000 },
  /** Tasks created from this item (action items). */
  actions: { type: [Schema.Types.ObjectId], default: [] },
});

/**
 * A project meeting (site visit, client review, weekly coordination…) with an agenda, minutes,
 * attendance and action items. Recurring meetings are separate documents sharing a seriesId.
 */
const meetingSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    location: { type: String, default: '', trim: true, maxlength: 300 },
    startsAt: { type: Date, required: true },
    durationMinutes: { type: Number, default: 60, min: 5, max: 1440 },
    organizer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    participants: { type: [participantSchema], default: [] },
    agenda: { type: [agendaItemSchema], default: [] },
    /** Rich text (sanitised HTML). */
    minutes: { type: String, default: '', maxlength: 50000 },
    status: { type: String, enum: MEETING_STATUSES, default: 'draft' },
    seriesId: { type: Schema.Types.ObjectId, default: null, index: true },
    recurrence: {
      type: new Schema({ frequency: { type: String, enum: RECURRENCE_FREQUENCIES, required: true }, until: { type: String, required: true } }, { _id: false }),
      default: null,
    },
    /** Bumped on every change so calendar apps replace the previous invitation. */
    sequence: { type: Number, default: 0 },
    closedAt: { type: Date, default: null },
    closedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
meetingSchema.index({ project: 1, startsAt: 1 });

export type MeetingAttrs = InferSchemaType<typeof meetingSchema>;
export type MeetingDoc = HydratedDocument<MeetingAttrs>;
export type AgendaItem = MeetingAttrs['agenda'][number] & { _id: Types.ObjectId };
export const Meeting = model('Meeting', meetingSchema);

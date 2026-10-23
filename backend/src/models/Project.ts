import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const PROJECT_STATUSES = ['active', 'on_hold', 'completed', 'archived'] as const;
export const MEMBER_ROLES = ['manager', 'member', 'viewer'] as const;
export const PROJECT_KINDS = ['project', 'program', 'portfolio'] as const;
export const PROJECT_MODULES = ['gantt', 'table', 'board', 'calendar', 'resources', 'activity'] as const;
export type ProjectModule = (typeof PROJECT_MODULES)[number];
export type MemberRole = (typeof MEMBER_ROLES)[number];
export type ProjectRole = 'owner' | MemberRole;

const memberSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: MEMBER_ROLES, required: true },
  },
  { _id: false },
);

const projectSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    /** Short code used in readable task IDs, e.g. "OF" → OF-12. */
    key: { type: String, uppercase: true, trim: true, unique: true, sparse: true },
    /** Last task number handed out in this project. */
    taskSeq: { type: Number, default: 0 },
    description: { type: String, default: '', maxlength: 2000 },
    /** project = plan with tasks; program / portfolio = containers that roll up their sub-projects. */
    kind: { type: String, enum: PROJECT_KINDS, default: 'project' },
    parent: { type: Schema.Types.ObjectId, ref: 'Project', default: null, index: true },
    isTemplate: { type: Boolean, default: false },
    /** Disabled modules are hidden from the project's tabs. */
    disabledModules: { type: [{ type: String, enum: PROJECT_MODULES }], default: [] },
    /** Life-cycle phases with planned dates and a gate decision at the end of each phase. */
    lifecycle: {
      type: [
        {
          _id: false,
          definition: { type: Schema.Types.ObjectId, ref: 'PhaseDefinition', required: true },
          start: { type: String, default: null },
          finish: { type: String, default: null },
          gateStatus: { type: String, enum: ['pending', 'passed', 'failed'], default: 'pending' },
        },
      ],
      default: [],
    },
    customValues: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: PROJECT_STATUSES, default: 'active' },
    startDate: { type: String, required: true },
    finishDate: { type: String, required: true },
    workingDays: { type: [Number], default: [1, 2, 3, 4, 5] },
    holidays: { type: [String], default: [] },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    members: { type: [memberSchema], default: [] },
    categories: { type: [{ name: { type: String, required: true, trim: true, maxlength: 60 } }], default: [] },
    baselineSavedAt: { type: Date, default: null },
    stats: {
      taskCount: { type: Number, default: 0 },
      completedCount: { type: Number, default: 0 },
      overdueCount: { type: Number, default: 0 },
      percentComplete: { type: Number, default: 0 },
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
projectSchema.index({ 'members.user': 1 });

export type ProjectAttrs = InferSchemaType<typeof projectSchema>;
export type ProjectDoc = HydratedDocument<ProjectAttrs>;
export const Project = model('Project', projectSchema);

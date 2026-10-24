import { Schema, model } from 'mongoose';

/** What time was spent on (Design, Site work, Meetings…). Organisation-wide list. */
const timeActivitySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 40 },
    color: { type: String, default: '#3b82f6', match: /^#[0-9a-fA-F]{6}$/ },
    position: { type: Number, default: 0 },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true },
);
export const TimeActivity = model('TimeActivity', timeActivitySchema);

export const DEFAULT_ACTIVITIES = [
  { name: 'Design', color: '#6366f1', isDefault: true },
  { name: 'Site work', color: '#f59e0b' },
  { name: 'Management', color: '#3b82f6' },
  { name: 'Meetings', color: '#14b8a6' },
  { name: 'Procurement', color: '#a855f7' },
];

/** Material/other cost kinds with a unit price (cement per bag, tiles per m², …). */
const costTypeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    unit: { type: String, default: 'unit', trim: true, maxlength: 20 },
    unitRate: { type: Number, required: true, min: 0 },
    color: { type: String, default: '#a855f7', match: /^#[0-9a-fA-F]{6}$/ },
    position: { type: Number, default: 0 },
  },
  { timestamps: true },
);
export const CostType = model('CostType', costTypeSchema);

/**
 * Hourly rate of a person. `project: null` = default rate; a project rate overrides it.
 * The rate valid on a date is the one with the latest `validFrom` on or before that date.
 */
const hourlyRateSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    project: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    rate: { type: Number, required: true, min: 0 },
    validFrom: { type: String, required: true },
  },
  { timestamps: true },
);
export const HourlyRate = model('HourlyRate', hourlyRateSchema);

/** Hours someone spent on a project (optionally a task). Cost = hours × rate valid on that date. */
const timeEntrySchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    task: { type: Schema.Types.ObjectId, default: null, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    activity: { type: Schema.Types.ObjectId, ref: 'TimeActivity', default: null },
    date: { type: String, required: true, index: true },
    hours: { type: Number, required: true, min: 0.01, max: 24 },
    comment: { type: String, default: '', maxlength: 500 },
    rate: { type: Number, default: 0 },
    cost: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
export const TimeEntry = model('TimeEntry', timeEntrySchema);

/** Material/other spend: units × the cost type's unit rate at the time of entry. */
const costEntrySchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    task: { type: Schema.Types.ObjectId, default: null },
    budget: { type: Schema.Types.ObjectId, ref: 'Budget', default: null },
    costType: { type: Schema.Types.ObjectId, ref: 'CostType', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true },
    units: { type: Number, required: true, min: 0 },
    unitRate: { type: Number, required: true, min: 0 },
    cost: { type: Number, required: true, min: 0 },
    comment: { type: String, default: '', maxlength: 500 },
  },
  { timestamps: true },
);
export const CostEntry = model('CostEntry', costEntrySchema);

/** Planned labour and material costs; tasks linked to the budget supply the actual spend. */
const budgetSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 2000 },
    labor: {
      type: [{ label: { type: String, default: '', maxlength: 80 }, user: { type: Schema.Types.ObjectId, ref: 'User', default: null }, hours: Number, rate: Number }],
      default: [],
    },
    material: {
      type: [{ costType: { type: Schema.Types.ObjectId, ref: 'CostType', required: true }, units: Number, unitRate: Number, comment: { type: String, default: '' } }],
      default: [],
    },
  },
  { timestamps: true },
);
export const Budget = model('Budget', budgetSchema);

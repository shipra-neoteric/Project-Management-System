import { Schema, model, type InferSchemaType } from 'mongoose';

export const CUSTOM_FIELD_SCOPES = ['task', 'project'] as const;
export const CUSTOM_FIELD_KINDS = ['text', 'longtext', 'number', 'date', 'select', 'multiselect', 'boolean', 'user'] as const;
export type CustomFieldKind = (typeof CUSTOM_FIELD_KINDS)[number];

/** Admin-defined extra attributes for tasks or projects. Values live in `customValues[fieldId]`. */
const customFieldSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    scope: { type: String, enum: CUSTOM_FIELD_SCOPES, required: true },
    kind: { type: String, enum: CUSTOM_FIELD_KINDS, required: true },
    options: { type: [{ name: { type: String, required: true, trim: true, maxlength: 60 } }], default: [] },
    required: { type: Boolean, default: false },
    position: { type: Number, default: 0 },
    description: { type: String, default: '', maxlength: 300 },
  },
  { timestamps: true },
);

export type CustomFieldAttrs = InferSchemaType<typeof customFieldSchema> & { _id: unknown };
export const CustomField = model('CustomField', customFieldSchema);

/** Organisation-wide project life-cycle phase (e.g. Initiating → Planning → Executing → Closing), with an optional gate at its end. */
const phaseDefinitionSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    color: { type: String, required: true, match: /^#[0-9a-fA-F]{6}$/ },
    gate: { type: String, default: '', trim: true, maxlength: 60 },
    position: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const PhaseDefinition = model('PhaseDefinition', phaseDefinitionSchema);

export const DEFAULT_PHASES = [
  { name: 'Initiating', color: '#6366f1', gate: 'Project approved' },
  { name: 'Planning', color: '#3b82f6', gate: 'Plan signed off' },
  { name: 'Executing', color: '#f59e0b', gate: 'Works complete' },
  { name: 'Closing', color: '#22c55e', gate: 'Handover accepted' },
];

import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const APP_ROLES = ['Admin', 'User'] as const;
export type AppRole = (typeof APP_ROLES)[number];

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: APP_ROLES, default: 'User' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export type UserAttrs = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<UserAttrs>;
export const User = model('User', userSchema);

/** Shape returned to clients — never includes the password hash. */
export function publicUser(user: UserDoc) {
  return {
    _id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role as AppRole,
    isActive: user.isActive,
  };
}

// zod schemas for every API input. The Worker validates with these; the web app
// only imports their inferred types.
import { z } from 'zod';

export const PIN_PATTERN = /^\d{4,8}$/;

export const pin = z.string().regex(PIN_PATTERN, 'PINs are 4 to 8 digits.');

const personName = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(40, 'Names can be up to 40 characters.');

const teamName = z
  .string()
  .trim()
  .min(1, 'Enter a team name.')
  .max(60, 'Team names can be up to 60 characters.');

const id = z.string().min(1).max(64);

export const setupInput = z
  .object({
    team_name: teamName,
    owner_name: personName,
    owner_pin: pin,
    team_pin: pin,
  })
  .refine((v) => v.owner_pin !== v.team_pin, {
    message: 'The owner PIN and the team PIN must be different.',
    path: ['team_pin'],
  });
export type SetupInput = z.input<typeof setupInput>;

export const loginInput = z.object({
  member_id: id,
  pin: z.string().regex(/^\d{1,12}$/, 'Enter your PIN using the number keys.'),
});
export type LoginInput = z.input<typeof loginInput>;

export const addMemberInput = z.object({ name: personName });
export type AddMemberInput = z.input<typeof addMemberInput>;

export const updateMemberInput = z.object({ active: z.boolean() });
export type UpdateMemberInput = z.input<typeof updateMemberInput>;

export const setPinInput = z.object({ pin });
export type SetPinInput = z.input<typeof setPinInput>;

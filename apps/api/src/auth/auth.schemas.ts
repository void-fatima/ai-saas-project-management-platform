import { z } from 'zod';

const emailSchema = z
  .email('Enter a valid email address.')
  .max(254, 'Email must be at most 254 characters.')
  .transform((email) => email.trim().toLowerCase());

const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters.')
  .max(128, 'Password must be at most 128 characters.')
  .regex(/[A-Za-z]/, 'Password must contain a letter.')
  .regex(/[0-9]/, 'Password must contain a number.');

export const registerSchema = z
  .object({
    email: emailSchema,
    name: z.string().trim().min(2).max(100),
    password: passwordSchema,
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(128),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

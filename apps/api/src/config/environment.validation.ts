import { z } from 'zod';

const environmentSchema = z
  .object({
    MAIL_MODE: z.enum(['disabled', 'development-file']).default('disabled'),
    AI_PROVIDER: z.enum(['disabled', 'openai', 'test']).default('disabled'),
    AI_MODEL: z
      .string()
      .regex(/^[a-zA-Z0-9._:-]{1,100}$/)
      .optional(),
    AI_API_KEY: z.string().min(1).optional(),
    AI_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(15000),
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(4096).default(2048),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    WEB_ORIGIN: z.url({ protocol: /^https?$/ }).refine((value) => {
      const url = new URL(value);
      return url.origin === value && !url.username && !url.password;
    }, 'Use an HTTP(S) origin without credentials, path, query, fragment, or trailing slash.'),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    SESSION_TTL_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 30)
      .default(24 * 7),
    SESSION_ROTATION_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 7)
      .default(24),
    SESSION_ABSOLUTE_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 90)
      .default(24 * 30),
  })
  .superRefine((config, context) => {
    if (config.AI_PROVIDER === 'test' && config.NODE_ENV !== 'test')
      context.addIssue({
        code: 'custom',
        path: ['AI_PROVIDER'],
        message: 'The deterministic provider is restricted to tests.',
      });
    if (config.AI_PROVIDER === 'openai' && (!config.AI_MODEL || !config.AI_API_KEY))
      context.addIssue({
        code: 'custom',
        path: ['AI_PROVIDER'],
        message: 'Live AI requires AI_MODEL and AI_API_KEY.',
      });
    if (config.NODE_ENV === 'production' && config.MAIL_MODE === 'development-file') {
      context.addIssue({
        code: 'custom',
        path: ['MAIL_MODE'],
        message: 'Development mail is forbidden in production.',
      });
    }
    if (config.SESSION_ROTATION_HOURS >= config.SESSION_TTL_HOURS) {
      context.addIssue({
        code: 'custom',
        path: ['SESSION_ROTATION_HOURS'],
        message: 'Rotation must be shorter than session TTL.',
      });
    }
    if (config.SESSION_TTL_HOURS > config.SESSION_ABSOLUTE_HOURS) {
      context.addIssue({
        code: 'custom',
        path: ['SESSION_ABSOLUTE_HOURS'],
        message: 'Absolute lifetime must be at least the session TTL.',
      });
    }
    if (config.NODE_ENV === 'production' && !config.WEB_ORIGIN.startsWith('https://')) {
      context.addIssue({
        code: 'custom',
        path: ['WEB_ORIGIN'],
        message: 'Production requires HTTPS.',
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(config: Record<string, unknown>): Environment {
  const result = environmentSchema.safeParse(config);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return result.data;
}

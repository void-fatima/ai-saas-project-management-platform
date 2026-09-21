import { z } from 'zod';

export const searchInput = z
  .object({
    q: z
      .string()
      .max(200)
      .default('')
      .transform((value) => value.trim().replace(/\s+/gu, ' '))
      .pipe(
        z
          .string()
          .max(100)
          .refine((value) => value.length !== 1, 'Use at least two characters.'),
      ),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    offset: z.coerce.number().int().min(0).max(10000).default(0),
    includeArchived: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  })
  .strict();
export type SearchInput = z.infer<typeof searchInput>;

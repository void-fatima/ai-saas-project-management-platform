import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

interface ValidationIssue {
  message: string;
  path: string;
}

export class ZodValidationPipe<TSchema extends z.ZodType> implements PipeTransform<unknown> {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.output<TSchema> {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      const errors: ValidationIssue[] = result.error.issues.map((issue) => ({
        message: issue.message,
        path: issue.path.join('.'),
      }));

      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        errors,
        message: 'The request body is invalid.',
      });
    }

    return result.data;
  }
}

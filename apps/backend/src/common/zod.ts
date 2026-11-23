import { applyDecorators, BadRequestException, Injectable, type PipeTransform, UsePipes } from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import { z, type ZodType } from 'zod';

@Injectable()
export class ZodValidationPipe<T extends ZodType> implements PipeTransform {
  constructor(
    private readonly schema: T,
    private readonly target: 'body' | 'query',
  ) {}

  transform(value: unknown, metadata: { type: string }) {
    if (metadata.type !== this.target) return value;
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}

/** Validates the request body with a Zod schema and documents it in OpenAPI. */
export function ZodBody(schema: ZodType) {
  return applyDecorators(
    UsePipes(new ZodValidationPipe(schema, 'body')),
    ApiBody({ schema: z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as object }),
  );
}

/** Validates query parameters with a Zod object schema. */
export function ZodQuery(schema: z.ZodObject) {
  const decorators = [UsePipes(new ZodValidationPipe(schema, 'query'))];
  for (const [name, field] of Object.entries(schema.shape)) {
    decorators.push(ApiQuery({ name, required: !(field as ZodType).safeParse(undefined).success, type: String }));
  }
  return applyDecorators(...decorators);
}

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

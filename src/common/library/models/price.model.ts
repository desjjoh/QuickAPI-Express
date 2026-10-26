import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

const decimalPrice = /^[0-9]+(?:\.[0-9]{1,2})?$/;

/** Validate decimal spelling rather than binary multiplication/modulo or rounding. */
export const PriceSchema = z
  .preprocess(
    (value) =>
      typeof value === 'string' &&
      value.trim() === value &&
      decimalPrice.test(value)
        ? Number(value)
        : value,
    z
      .number()
      .min(0.01)
      .max(99_999_999.99)
      .refine((value) => decimalPrice.test(String(value)), {
        message: 'Price must have at most two decimal places.',
      }),
  )
  .openapi({
    description:
      'Price from 0.01 through 99999999.99 with at most two decimal places; excess precision is rejected, never rounded. Input also accepts unsigned plain decimal strings. Responses are numbers.',
    multipleOf: 0.01,
    example: 49.99,
  });

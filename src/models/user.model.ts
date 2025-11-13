import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const UserSchema = z.object({
  id: z.number().int().openapi({ example: 1 }),
  createdAt: z.iso.datetime().openapi({ example: '2025-10-29T14:30:00Z' }),
  name: z.string().openapi({ example: 'John Doe' }),
  email: z.email().openapi({ example: 'john@example.com' }),
});

export const CreateUserSchema = UserSchema.pick({
  name: true,
  email: true,
}).openapi('CreateUserInput');

export const UpdateUserSchema = CreateUserSchema.partial()
  .refine(data => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update.',
  })
  .openapi('UpdateUserInput');

export const UserResponseSchema = UserSchema.openapi('UserResponse');

export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
export type UserResponse = z.infer<typeof UserResponseSchema>;

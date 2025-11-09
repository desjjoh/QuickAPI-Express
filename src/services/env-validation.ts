import 'dotenv/config';
import { z, ZodError } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
});

let env: z.infer<typeof EnvSchema>;

try {
  env = EnvSchema.parse(process.env);
} catch (err) {
  if (err instanceof ZodError) {
    process.stdout.write('Invalid environment configuration');

    for (const issue of err.issues) {
      const field = issue.path.join('.') || '(root)';
      const received = issue.message.match(/received\s"?(.*?)"?$/)?.[1];
      const message = issue.message
        .replace(/^Invalid input[: ]*/, '')
        .replace(/^Invalid enum value[,: ]*/, '')
        .replace(/received\s.*$/, '')
        .trim();

      const formatted = received
        ? `  ↳ Invalid ${field} → ${message} got "${received}"`
        : `  ↳ Invalid ${field} → ${message}`;

      process.stdout.write(formatted);
    }
  } else {
    process.stdout.write('Unexpected error during environment validation');
  }

  process.exit(1);
}

export { env };

export const isProd = env.NODE_ENV === 'production';
export const isDev = env.NODE_ENV === 'development';

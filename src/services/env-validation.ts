import 'dotenv/config';
import { z, ZodError } from 'zod';
import { logger } from '@/services/pino';

const EnvSchema: z.ZodObject = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

let env: z.infer<typeof EnvSchema>;

try {
  env = EnvSchema.parse(process.env);
} catch (err) {
  if (err instanceof ZodError) {
    logger.fatal('Invalid environment configuration');

    const tree = z.treeifyError(err);
    for (const [key, issues] of Object.entries(tree)) {
      logger.fatal({
        field: key,
        message: Array.isArray(issues) ? issues.join(', ') : String(issues),
      });
    }
  } else {
    logger.fatal({ err }, 'Unexpected error during environment validation');
  }

  process.exit(1);
}

export { env };

export const isProd = env.NODE_ENV === 'production';
export const isDev = env.NODE_ENV === 'development';

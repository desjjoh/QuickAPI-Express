/**
 * @fileoverview Environment variable validation and configuration.
 * @module config/env-validation
 * @description
 *  Loads, validates, and exports application environment variables using Zod.
 *  Ensures the process environment contains all required configuration keys
 *  before the application starts.
 *
 * @remarks
 *  - Uses `dotenv` to automatically load `.env` files into `process.env`.
 *  - Performs schema validation via Zod to enforce type safety.
 *  - Terminates startup immediately if environment configuration is invalid.
 *
 * @example
 *  import { env, isDev } from "@/config/env-validation";
 *  if (isDev) logger.info("Running in development mode");
 */

import 'dotenv/config';
import { z, ZodError } from 'zod';
import { logger } from '@/logger/logger.js';

/**
 * Environment schema definition.
 *
 * @constant
 * @type {z.ZodObject}
 * @description
 *  Defines required environment variables and their respective types.
 *  Includes defaults for development use.
 */
const EnvSchema: z.ZodObject = z.object({
  /** Current runtime environment. */
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** HTTP server port number. */
  PORT: z.coerce.number().default(3000),

  /** Logging verbosity level. */
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

let env: z.infer<typeof EnvSchema>;

try {
  env = EnvSchema.parse(process.env);
} catch (err) {
  if (err instanceof ZodError) {
    logger.fatal('Invalid environment configuration');

    // Log validation issues for each environment variable
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

/**
 * Validated and strongly typed environment configuration object.
 *
 * @example
 *  console.log(env.PORT); // 3000
 */
export { env };

/**
 * Boolean flag for production environment.
 */
export const isProd = env.NODE_ENV === 'production';

/**
 * Boolean flag for development environment.
 */
export const isDev = env.NODE_ENV === 'development';

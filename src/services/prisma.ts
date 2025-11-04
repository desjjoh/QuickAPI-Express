/**
 * @fileoverview Prisma client initialization.
 * @module db/prisma
 * @description
 *  Exports a shared Prisma client instance configured for the current application.
 *  The client provides a type-safe database interface for all ORM operations.
 *
 * @remarks
 *  - Centralized client instance prevents redundant connections.
 *  - Logs only warnings and errors to reduce noise in production.
 *  - Does not perform automatic migrations — migrations should be applied manually via CLI.
 *
 * @example
 *  import { prisma } from "@/services/prisma";
 *  const users = await prisma.user.findMany();
 */

import { PrismaClient } from '@prisma/client';

/**
 * Shared Prisma client instance for database access.
 *
 * @constant
 * @type {PrismaClient}
 * @description
 *  Configured to log warnings and errors while maintaining connection
 *  efficiency across all imported modules.
 */
export const prisma = new PrismaClient({
  log: ['error', 'warn'],
});

import { OpenApiGeneratorV3, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { registerItemPaths } from './_items.docs';
import { registerSystemPaths } from './_system.docs';

const registry = new OpenAPIRegistry();

// System + diagnostics endpoints
registerSystemPaths(registry);

// Main API endpoints
registerItemPaths(registry);

export const generator = new OpenApiGeneratorV3(registry.definitions);

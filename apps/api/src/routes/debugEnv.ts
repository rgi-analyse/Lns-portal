import type { FastifyInstance } from 'fastify';

const PBI_VARS = [
  'PBI_TENANT_ID',
  'PBI_CLIENT_ID',
  'PBI_CLIENT_SECRET',
  'PBI_WORKSPACE_ID',
  'PBI_REPORT_ID',
] as const;

export async function debugEnvRoutes(fastify: FastifyInstance) {
  fastify.get('/api/debug-env', async () => {
    return Object.fromEntries(
      PBI_VARS.map((key) => [key, Boolean(process.env[key])])
    );
  });
}

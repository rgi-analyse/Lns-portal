import type { FastifyInstance } from 'fastify';
import { executeQuery } from '../services/fabricService';

export async function debugSchemasRoutes(fastify: FastifyInstance) {
  fastify.get('/api/debug/schemas', async (_request, reply) => {
    try {
      const result = await executeQuery(`
        SELECT TABLE_SCHEMA, TABLE_NAME
        FROM INFORMATION_SCHEMA.VIEWS
      `, 200);
      return reply.send(result);
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Ukjent feil' });
    }
  });
}

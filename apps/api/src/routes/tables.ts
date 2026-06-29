import type { FastifyInstance, FastifyRequest } from 'fastify';
import { logger } from '../lib/logger';
import { getTableSchema } from '../services/fabricService';
import { feilRespons } from '../lib/feilRespons';

const schemaCache: Record<string, string[]> = {};

export async function tablesRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { rapportId?: string } }>(
    '/api/tables',
    async (request: FastifyRequest<{ Querystring: { rapportId?: string } }>, reply) => {
      const { rapportId } = request.query;
      const cacheKey = rapportId ?? '__global__';

      if (schemaCache[cacheKey]) {
        logger.debug('[Tables] Returnerer cached tabeller for:', cacheKey);
        return reply.send({ tables: schemaCache[cacheKey] });
      }

      try {
        const tables = await getTableSchema();
        const tableNames = tables.map((t) => t.fullName);
        schemaCache[cacheKey] = tableNames;
        logger.debug('[Tables] Hentet og cachet tabeller for:', cacheKey, '— antall:', tableNames.length);
        return reply.send({ tables: tableNames });
      } catch (err) {
        return feilRespons(reply, 500, 'Kunne ikke hente tabellen.', err);
      }
    },
  );
}

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma';

interface HealthStatus {
  status: 'ok' | 'degraded';
  timestamp: string;
  version: string;
  uptime: number;
  checks: {
    database: {
      status: 'ok' | 'error';
      responseTimeMs?: number;
      error?: string;
    };
  };
}

export async function healthRoutes(fastify: FastifyInstance) {
  // Full health check med DB-ping
  fastify.get('/health', async (_req: FastifyRequest, reply: FastifyReply) => {
    const start = Date.now();
    const health: HealthStatus = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '1.0.0',
      uptime: Math.floor(process.uptime()),
      checks: {
        database: { status: 'ok' },
      },
    };

    try {
      await prisma.$queryRaw`SELECT 1 AS ping`;
      health.checks.database.responseTimeMs = Date.now() - start;
    } catch (err: unknown) {
      health.status = 'degraded';
      health.checks.database.status = 'error';
      health.checks.database.error =
        err instanceof Error ? err.message : 'Unknown error';
    }

    return reply.status(health.status === 'ok' ? 200 : 503).send(health);
  });

  // Liveness probe — svarer alltid 200 så lenge prosessen kjører
  fastify.get('/health/live', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ status: 'ok', timestamp: new Date().toISOString() });
  });
}

import type { FastifyInstance } from 'fastify';
import { requireBruker, type AuthRequest } from '../middleware/auth';
import { queryAzureSQL, executeAzureSQL } from '../services/azureSqlService';
import { prisma } from '../lib/prisma';

interface TtsInnstillinger {
  stemmNavn?: string;
  hastighet?: number;
  autoOpplesing?: boolean;
  sttAktivert?: boolean;
}

interface BrukerInnstillinger {
  tts?: TtsInnstillinger;
}

// id er en UUID satt av vår egen prisma-kode — trygt å interpolere
function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9\-]/g, '');
}

export async function megInnstillingerRoutes(fastify: FastifyInstance) {
  // GET /api/meg — returnerer innlogget brukers grunninfo (rolle m.m.)
  fastify.get('/api/meg', { preHandler: [requireBruker] }, async (request, reply) => {
    const bruker = (request as AuthRequest).bruker;
    const profil = await prisma.userProfile.findUnique({
      where:  { userId: bruker.id },
      select: { harAnalyseTilgang: true },
    });
    return reply.send({
      id:                bruker.id,
      rolle:             bruker.rolle,
      displayName:       bruker.displayName,
      email:             bruker.email,
      chatAktivert:      bruker.chatAktivert,
      harAnalyseTilgang: profil?.harAnalyseTilgang ?? false,
    });
  });

  // GET /api/meg/innstillinger
  fastify.get('/api/meg/innstillinger', { preHandler: [requireBruker] }, async (request, reply) => {
    const { id } = (request as AuthRequest).bruker;

    const rows = await queryAzureSQL(
      `SELECT innstillinger FROM bruker WHERE id = '${safeId(id)}'`,
    );

    const raw = (rows[0] as { innstillinger?: string } | undefined)?.innstillinger;
    try {
      return reply.send(raw ? JSON.parse(raw) : {});
    } catch {
      return reply.send({});
    }
  });

  // GET /api/meg/favoritter — returnerer workspace-IDer brukeren har pinnet
  fastify.get('/api/meg/favoritter', { preHandler: [requireBruker] }, async (request, reply) => {
    const { id } = (request as AuthRequest).bruker;
    try {
      const rows = await queryAzureSQL(
        `SELECT workspaceId FROM brukerFavoritter WHERE brukerId = '${safeId(id)}'`,
      );
      const ids = rows.map((r) => (r as { workspaceId: string }).workspaceId);
      return reply.send(ids);
    } catch {
      // Tabell finnes ikke ennå
      return reply.send([]);
    }
  });

  // POST /api/meg/favoritter/:workspaceId — legg til favoritt
  fastify.post<{ Params: { workspaceId: string } }>(
    '/api/meg/favoritter/:workspaceId',
    { preHandler: [requireBruker] },
    async (request, reply) => {
      const { id } = (request as AuthRequest).bruker;
      const wsId = safeId(request.params.workspaceId);
      try {
        await executeAzureSQL(`
          IF NOT EXISTS (
            SELECT 1 FROM brukerFavoritter
            WHERE brukerId = '${safeId(id)}' AND workspaceId = '${wsId}'
          )
          INSERT INTO brukerFavoritter (brukerId, workspaceId)
          VALUES ('${safeId(id)}', '${wsId}')
        `);
        return reply.status(201).send({ ok: true });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: 'Kunne ikke lagre favoritt.', detail });
      }
    },
  );

  // DELETE /api/meg/favoritter/:workspaceId — fjern favoritt
  fastify.delete<{ Params: { workspaceId: string } }>(
    '/api/meg/favoritter/:workspaceId',
    { preHandler: [requireBruker] },
    async (request, reply) => {
      const { id } = (request as AuthRequest).bruker;
      const wsId = safeId(request.params.workspaceId);
      try {
        await executeAzureSQL(
          `DELETE FROM brukerFavoritter WHERE brukerId = '${safeId(id)}' AND workspaceId = '${wsId}'`,
        );
        return reply.status(204).send();
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: 'Kunne ikke fjerne favoritt.', detail });
      }
    },
  );

  // PUT /api/meg/innstillinger
  fastify.put<{ Body: Partial<BrukerInnstillinger> }>(
    '/api/meg/innstillinger',
    { preHandler: [requireBruker] },
    async (request, reply) => {
      const { id } = (request as AuthRequest).bruker;

      // Hent eksisterende
      const rows = await queryAzureSQL(
        `SELECT innstillinger FROM bruker WHERE id = '${safeId(id)}'`,
      );
      const raw = (rows[0] as { innstillinger?: string } | undefined)?.innstillinger;

      let eksisterende: BrukerInnstillinger = {};
      try { eksisterende = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }

      const oppdatert: BrukerInnstillinger = {
        ...eksisterende,
        ...request.body,
        tts: { ...eksisterende.tts, ...request.body.tts },
      };

      // JSON-verdi escapes apostrofer
      const json = JSON.stringify(oppdatert).replace(/'/g, "''");
      await executeAzureSQL(
        `UPDATE bruker SET innstillinger = '${json}' WHERE id = '${safeId(id)}'`,
      );

      return reply.send(oppdatert);
    },
  );
}

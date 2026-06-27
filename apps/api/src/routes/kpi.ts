import type { FastifyInstance } from 'fastify';
import { logger } from '../lib/logger';
import { queryAzureSQL } from '../services/azureSqlService';
import { requireBruker, type AuthRequest } from '../middleware/auth';
import { validerKpiUttrykk } from '../services/kpiValidator';

const esc = (s: string): string => s.replace(/'/g, "''");

interface LagreKpiBody {
  view_navn:    string;  // schema.viewname eller bare viewname (default schema ai_gold)
  navn:         string;
  visningsnavn: string;
  sql_uttrykk:  string;
  format:       string;
  beskrivelse?: string;
}

export async function kpiRoutes(fastify: FastifyInstance) {
  // POST /api/kpi/lagre
  // Brukes av "Lagre som KPI"-knappene i AI-chatten. Mirrer logikken i
  // opprett_kpi-tool-handleren, men er HTTP-eksponert slik at frontend
  // kan kalle direkte uten å gå gjennom en ny tool-runde.
  //
  // Auth: requireBruker. Den underliggende KPI-flyten i chat krever
  // kanLageRapport-context, og brukeren har allerede sett forslaget i
  // den samtalen — ekstra autorisering på HTTP-laget ville duplisert
  // sjekken uten reelle gevinster.
  fastify.post<{ Body: LagreKpiBody }>(
    '/api/kpi/lagre',
    {
      preHandler: [requireBruker],
      schema: {
        body: {
          type: 'object',
          required: ['view_navn', 'navn', 'visningsnavn', 'sql_uttrykk', 'format'],
          properties: {
            view_navn:    { type: 'string', minLength: 1 },
            navn:         { type: 'string', minLength: 1, maxLength: 255 },
            visningsnavn: { type: 'string', minLength: 1, maxLength: 255 },
            sql_uttrykk:  { type: 'string', minLength: 1 },
            format:       { type: 'string', enum: ['prosent', 'nok', 'antall', 'desimal'] },
            beskrivelse:  { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const bruker = (request as AuthRequest).bruker;
      const { view_navn, navn, visningsnavn, sql_uttrykk, format, beskrivelse } = request.body;

      // Tillat både "ai_gold.vw_X" og bare "vw_X" (default schema ai_gold)
      const parts  = view_navn.includes('.') ? view_navn.split('.') : ['ai_gold', view_navn];
      const schema = parts[0] ?? 'ai_gold';
      const view   = parts[1] ?? view_navn;

      // Slå opp view_id
      const viewRader = await queryAzureSQL(
        `SELECT TOP 1 id FROM ai_metadata_views
         WHERE schema_name = '${esc(schema)}' AND view_name = '${esc(view)}' AND er_aktiv = 1`,
        1,
      );
      if (viewRader.length === 0) {
        return reply.status(404).send({
          error: `View '${schema}.${view}' er ikke registrert i metadata.`,
        });
      }
      const viewId = String(viewRader[0]['id']);

      // Dedup på (view_id, navn) blant aktive
      const eksisterende = await queryAzureSQL(`
        SELECT id, navn, visningsnavn
        FROM ai_metadata_kpi
        WHERE view_id = '${esc(viewId)}' AND navn = '${esc(navn)}' AND er_aktiv = 1
      `, 1);
      if (eksisterende.length > 0) {
        return reply.status(409).send({
          error: `KPI "${visningsnavn}" finnes allerede.`,
          duplikat: true,
          kpi: eksisterende[0],
        });
      }

      // Validér uttrykket statisk + prøvekjør mot viewet
      const validering = await validerKpiUttrykk(sql_uttrykk, schema, view);
      if (!validering.ok) {
        return reply.status(400).send({
          error: validering.feilmelding ?? 'Ugyldig SQL-uttrykk.',
        });
      }

      try {
        const rader = await queryAzureSQL(`
          INSERT INTO ai_metadata_kpi (view_id, navn, visningsnavn, sql_uttrykk, format, beskrivelse)
          OUTPUT INSERTED.id, INSERTED.view_id, INSERTED.navn, INSERTED.visningsnavn,
                 INSERTED.sql_uttrykk, INSERTED.format, INSERTED.beskrivelse
          VALUES (
            '${esc(viewId)}', '${esc(navn)}', '${esc(visningsnavn)}',
            '${esc(sql_uttrykk)}', '${esc(format)}',
            ${beskrivelse ? `'${esc(beskrivelse)}'` : 'NULL'}
          )
        `, 1);
        logger.debug('[kpi.lagre] opprettet KPI:', navn, 'for', schema + '.' + view, 'av', bruker.email);
        return reply.status(201).send({ success: true, kpi: rader[0] });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('[kpi.lagre] INSERT feilet:', msg);
        return reply.status(500).send({ error: `KPI-insert feilet: ${msg}` });
      }
    },
  );
}

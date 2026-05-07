/**
 * Endepunkt for slicer-katalog-søk i Azure AI Search.
 *
 * POST /api/slicer-katalog/søk
 *
 * Brukes av:
 *   - Validator-laget i AI tool-handler (set_report_slicer)
 *   - Eventuelt frontend for autocomplete senere
 */

import type { FastifyInstance } from 'fastify';
import { resolveBruker, requireBruker } from '../middleware/auth';
import { resolveTenant, type TenantRequest } from '../middleware/tenant';
import {
  søk as søkKatalog,
  erIndeksert,
  erTvetydig,
} from '../services/slicerKatalogService';

interface SøkBody {
  rapport_id:      string;
  slicer_tittel:   string;
  søketerm:        string;
  forelder_verdi?: string;
  top?:            number;
}

export async function slicerKatalogRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: SøkBody }>(
    '/api/slicer-katalog/søk',
    {
      preHandler: [resolveTenant, resolveBruker, requireBruker],
      schema: {
        body: {
          type: 'object',
          required: ['rapport_id', 'slicer_tittel', 'søketerm'],
          properties: {
            rapport_id:     { type: 'string', minLength: 1 },
            slicer_tittel:  { type: 'string', minLength: 1 },
            søketerm:       { type: 'string', minLength: 1 },
            forelder_verdi: { type: 'string' },
            top:            { type: 'integer', minimum: 1, maximum: 50 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { rapport_id, slicer_tittel, søketerm, forelder_verdi, top } = request.body;
      const tenantReq = request as TenantRequest;
      const tenant    = tenantReq.tenantSlug;
      if (!tenant) return reply.status(400).send({ error: 'Mangler tenant-kontekst.' });

      // Tilgangs-sjekk: brukeren må ha tilgang til rapporten.
      // Vi følger samme logikk som /api/rapporter/:id — finn rapport, sjekk workspace-tilhørighet.
      const rapport = await tenantReq.tenantPrisma.rapport.findUnique({
        where:   { id: rapport_id },
        include: { workspaces: { select: { workspaceId: true } } },
      });
      if (!rapport) return reply.status(404).send({ error: 'Rapport ikke funnet.' });

      // Sjekk indekserings-status. Hvis ikke indeksert: returner tomt med flagg slik at
      // klienten/validator-laget kan falle tilbake til lokal matching.
      const status = await erIndeksert(tenant, rapport_id, slicer_tittel);
      if (!status.indeksert) {
        console.log(`[search-katalog] ikke indeksert: tenant=${tenant} rapport=${rapport_id} slicer=${slicer_tittel}`);
        return reply.send({
          treff:             [],
          tvetydig:          false,
          indeksert:         false,
          antall_dokumenter: 0,
        });
      }

      console.log(`[search-katalog] søker: tenant=${tenant} rapport=${rapport_id} slicer=${slicer_tittel} term=${søketerm}${forelder_verdi ? ` forelder=${forelder_verdi}` : ''}`);

      const respons = await søkKatalog({
        tenant,
        rapport_id,
        slicer_tittel,
        søketerm,
        forelder_verdi,
        top: top ?? 5,
      });

      const tvetydig = erTvetydig(respons.treff);
      console.log(`[search-katalog] ${respons.treff.length} treff, ${tvetydig ? 'tvetydig' : 'entydig'}${respons.treff.length >= 2 ? ` (${respons.treff[0].score.toFixed(2)} vs ${respons.treff[1].score.toFixed(2)})` : ''}`);

      return reply.send({
        treff:             respons.treff,
        tvetydig,
        indeksert:         true,
        antall_dokumenter: status.antallDokumenter ?? 0,
      });
    },
  );
}

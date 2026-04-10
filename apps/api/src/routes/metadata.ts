import type { FastifyInstance } from 'fastify';
import { queryAzureSQL, executeAzureSQL } from '../services/azureSqlService';
import { syncViewColumns, syncAllViews, discoverNewViews } from '../services/metadataSync';
import { requireBruker, requireAdmin } from '../middleware/auth';

const esc = (val: string): string => val.replace(/'/g, "''").replace(/\r\n/g, '\n').replace(/\r/g, '\n');

export async function metadataRoutes(fastify: FastifyInstance) {

  // GET /api/admin/metadata/views — alle views med kolonner, eksempler og regler
  fastify.get('/api/admin/metadata/views', { preHandler: [requireBruker, requireAdmin] }, async (_request, reply) => {
    const [views, kolonner, eksempler, regler] = await Promise.all([
      queryAzureSQL(`
        SELECT id, schema_name, view_name, visningsnavn, beskrivelse, område, prosjekter,
               er_aktiv, sist_synkronisert, opprettet,
               prosjekt_kolonne, COALESCE(prosjekt_kolonne_type, 'number') as prosjekt_kolonne_type
        FROM ai_metadata_views
        ORDER BY område, view_name
      `),
      queryAzureSQL(`
        SELECT id, view_id, kolonne_navn, datatype, beskrivelse, eksempel_verdier,
               er_filtrerbar, sort_order, COALESCE(kolonne_type, 'dimensjon') as kolonne_type,
               lenketekst
        FROM ai_metadata_kolonner
        ORDER BY view_id, sort_order
      `),
      queryAzureSQL(`
        SELECT id, view_id, spørsmål, sql_eksempel
        FROM ai_metadata_eksempler
        ORDER BY view_id
      `),
      queryAzureSQL(`
        SELECT id, view_id, regel
        FROM ai_metadata_regler
        ORDER BY view_id
      `),
    ]);

    const result = views.map(v => ({
      ...v,
      kolonner: kolonner.filter(k => k['view_id'] === v['id']),
      eksempler: eksempler.filter(e => e['view_id'] === v['id']),
      regler: regler.filter(r => r['view_id'] === v['id']),
    }));

    return reply.send(result);
  });

  // GET /api/admin/metadata/views/:id — enkelt view med alle detaljer
  fastify.get<{ Params: { id: string } }>(
    '/api/admin/metadata/views/:id',
    { preHandler: [requireBruker, requireAdmin] },
    async (request, reply) => {
      const { id } = request.params;
      const [views, kolonner, eksempler, regler] = await Promise.all([
        queryAzureSQL(`
          SELECT id, schema_name, view_name, visningsnavn, beskrivelse, område, prosjekter,
                 er_aktiv, sist_synkronisert, opprettet,
                 prosjekt_kolonne, COALESCE(prosjekt_kolonne_type, 'number') as prosjekt_kolonne_type
          FROM ai_metadata_views
          WHERE id = '${esc(id)}'
        `, 1),
        queryAzureSQL(`
          SELECT id, view_id, kolonne_navn, datatype, beskrivelse, eksempel_verdier,
                 er_filtrerbar, sort_order, COALESCE(kolonne_type, 'dimensjon') as kolonne_type,
                 lenketekst
          FROM ai_metadata_kolonner
          WHERE view_id = '${esc(id)}'
          ORDER BY sort_order
        `),
        queryAzureSQL(`
          SELECT id, view_id, spørsmål, sql_eksempel
          FROM ai_metadata_eksempler
          WHERE view_id = '${esc(id)}'
        `),
        queryAzureSQL(`
          SELECT id, view_id, regel
          FROM ai_metadata_regler
          WHERE view_id = '${esc(id)}'
        `),
      ]);

      if (views.length === 0) return reply.status(404).send({ error: 'Ikke funnet' });

      return reply.send({ ...views[0], kolonner, eksempler, regler });
    },
  );

  // POST /api/admin/metadata/views — opprett nytt view
  fastify.post<{ Body: { schema_name: string; view_name: string; visningsnavn: string; beskrivelse?: string; område?: string; prosjekter?: string } }>(
    '/api/admin/metadata/views',
    { preHandler: [requireBruker, requireAdmin] },
    async (request, reply) => {
      const { schema_name, view_name, visningsnavn, beskrivelse, område, prosjekter } = request.body;
      const rows = await queryAzureSQL(`
        INSERT INTO ai_metadata_views (schema_name, view_name, visningsnavn, beskrivelse, område, prosjekter)
        OUTPUT INSERTED.id, INSERTED.schema_name, INSERTED.view_name, INSERTED.visningsnavn,
               INSERTED.beskrivelse, INSERTED.område, INSERTED.prosjekter, INSERTED.er_aktiv, INSERTED.opprettet
        VALUES (
          '${esc(schema_name)}', '${esc(view_name)}', '${esc(visningsnavn)}',
          ${beskrivelse ? `'${esc(beskrivelse)}'` : 'NULL'},
          ${område ? `'${esc(område)}'` : 'NULL'},
          ${prosjekter ? `'${esc(prosjekter)}'` : 'NULL'}
        )
      `, 1);
      return reply.status(201).send({ ...rows[0], kolonner: [], eksempler: [], regler: [] });
    },
  );

  // PUT /api/admin/metadata/views/:id — oppdater view-metadata
  fastify.put<{ Params: { id: string }; Body: { visningsnavn?: string; beskrivelse?: string; område?: string; prosjekter?: string; prosjekt_kolonne?: string | null; prosjekt_kolonne_type?: string; er_aktiv?: boolean } }>(
    '/api/admin/metadata/views/:id',
    { preHandler: [requireBruker, requireAdmin] },
    async (request, reply) => {
      const { id } = request.params;
      const { visningsnavn, beskrivelse, område, prosjekter, prosjekt_kolonne, prosjekt_kolonne_type, er_aktiv } = request.body;

      const validProjektTyper = ['number', 'string', 'name'];
      const setParts: string[] = [];
      if (visningsnavn !== undefined) setParts.push(`visningsnavn = '${esc(visningsnavn)}'`);
      if (beskrivelse !== undefined) setParts.push(`beskrivelse = ${beskrivelse ? `'${esc(beskrivelse)}'` : 'NULL'}`);
      if (område !== undefined) setParts.push(`område = ${område ? `'${esc(område)}'` : 'NULL'}`);
      if (prosjekter !== undefined) setParts.push(`prosjekter = ${prosjekter ? `'${esc(prosjekter)}'` : 'NULL'}`);
      if (prosjekt_kolonne !== undefined) setParts.push(`prosjekt_kolonne = ${prosjekt_kolonne ? `'${esc(prosjekt_kolonne)}'` : 'NULL'}`);
      if (prosjekt_kolonne_type !== undefined && validProjektTyper.includes(prosjekt_kolonne_type)) {
        setParts.push(`prosjekt_kolonne_type = '${esc(prosjekt_kolonne_type)}'`);
      }
      if (er_aktiv !== undefined) setParts.push(`er_aktiv = ${er_aktiv ? 1 : 0}`);

      if (setParts.length === 0) return reply.status(400).send({ error: 'Ingen felter å oppdatere' });

      await executeAzureSQL(`
        UPDATE ai_metadata_views
        SET ${setParts.join(', ')}
        WHERE id = '${esc(id)}'
      `);

      const rows = await queryAzureSQL(`
        SELECT id, schema_name, view_name, visningsnavn, beskrivelse, område, prosjekter,
               er_aktiv, sist_synkronisert, opprettet,
               prosjekt_kolonne, COALESCE(prosjekt_kolonne_type, 'number') as prosjekt_kolonne_type
        FROM ai_metadata_views WHERE id = '${esc(id)}'
      `, 1);

      return reply.send(rows[0]);
    },
  );

  // DELETE /api/admin/metadata/views/:id — deaktiver view (soft delete)
  fastify.delete<{ Params: { id: string } }>(
    '/api/admin/metadata/views/:id',
    { preHandler: [requireBruker, requireAdmin] },
    async (request, reply) => {
      await executeAzureSQL(`
        UPDATE ai_metadata_views SET er_aktiv = 0 WHERE id = '${esc(request.params.id)}'
      `);
      return reply.status(204).send();
    },
  );

  // POST /api/admin/metadata/views/:id/sync — synkroniser kolonner for ett view
  fastify.post<{ Params: { id: string } }>(
    '/api/admin/metadata/views/:id/sync',
    { preHandler: [requireBruker, requireAdmin] },
    async (request, reply) => {
      const { id } = request.params;
      const views = await queryAzureSQL(`
        SELECT schema_name, view_name FROM ai_metadata_views WHERE id = '${esc(id)}'
      `, 1);

      if (views.length === 0) return reply.status(404).send({ error: 'Ikke funnet' });

      const result = await syncViewColumns(
        id,
        views[0]['schema_name'] as string,
        views[0]['view_name'] as string,
      );

      const kolonner = await queryAzureSQL(`
        SELECT id, view_id, kolonne_navn, datatype, beskrivelse, eksempel_verdier,
               er_filtrerbar, sort_order, COALESCE(kolonne_type, 'dimensjon') as kolonne_type
        FROM ai_metadata_kolonner
        WHERE view_id = '${esc(id)}'
        ORDER BY sort_order
      `);

      return reply.send({ ...result, kolonner });
    },
  );

  // POST /api/admin/metadata/sync-all — synkroniser alle aktive views
  fastify.post(
    '/api/admin/metadata/sync-all',
    { preHandler: [requireBruker, requireAdmin] },
    async (_request, reply) => {
      const results = await syncAllViews();
      return reply.send({ synkronisert: results.length, detaljer: results });
    },
  );

  // GET /api/admin/metadata/discover — finn nye views i ai_gold
  fastify.get(
    '/api/admin/metadata/discover',
    { preHandler: [requireBruker, requireAdmin] },
    async (_request, reply) => {
      const nyeViews = await discoverNewViews();
      return reply.send({ antall: nyeViews.length, views: nyeViews });
    },
  );

  // DELETE /api/admin/metadata/views/:id/kolonner/:kolId — slett enkeltkolonne
  fastify.delete<{ Params: { id: string; kolId: string } }>(
    '/api/admin/metadata/views/:id/kolonner/:kolId',
    { preHandler: [requireBruker, requireAdmin] },
    async (request, reply) => {
      const { id, kolId } = request.params;
      const rows = await queryAzureSQL(`
        SELECT id FROM ai_metadata_kolonner
        WHERE id = '${esc(kolId)}' AND view_id = '${esc(id)}'
      `, 1);
      if (rows.length === 0) return reply.status(404).send({ error: 'Kolonne ikke funnet.' });
      await executeAzureSQL(`
        DELETE FROM ai_metadata_kolonner WHERE id = '${esc(kolId)}' AND view_id = '${esc(id)}'
      `);
      return reply.status(204).send();
    },
  );

  // PUT /api/admin/metadata/views/:id/kolonner/:kolId — oppdater kolonne manuelt
  fastify.put<{ Params: { id: string; kolId: string }; Body: { beskrivelse?: string; eksempel_verdier?: string; kolonne_type?: string; lenketekst?: string } }>(
    '/api/admin/metadata/views/:id/kolonner/:kolId',
    { preHandler: [requireBruker, requireAdmin] },
    async (request, reply) => {
      const { kolId } = request.params;
      const { beskrivelse, eksempel_verdier, kolonne_type, lenketekst } = request.body;

      const validTyper = ['dimensjon', 'measure', 'dato', 'id', 'url'];
      const setParts: string[] = [];
      if (beskrivelse !== undefined) setParts.push(`beskrivelse = ${beskrivelse ? `'${esc(beskrivelse)}'` : 'NULL'}`);
      if (eksempel_verdier !== undefined) setParts.push(`eksempel_verdier = ${eksempel_verdier ? `'${esc(eksempel_verdier)}'` : 'NULL'}`);
      if (kolonne_type !== undefined && validTyper.includes(kolonne_type)) setParts.push(`kolonne_type = '${esc(kolonne_type)}'`);
      if (lenketekst !== undefined) setParts.push(`lenketekst = ${lenketekst ? `'${esc(lenketekst)}'` : 'NULL'}`);

      if (setParts.length === 0) return reply.status(400).send({ error: 'Ingen felter å oppdatere' });

      await executeAzureSQL(`
        UPDATE ai_metadata_kolonner
        SET ${setParts.join(', ')}
        WHERE id = '${esc(kolId)}'
      `);

      const rows = await queryAzureSQL(`
        SELECT id, view_id, kolonne_navn, datatype, beskrivelse, eksempel_verdier,
               er_filtrerbar, sort_order, COALESCE(kolonne_type, 'dimensjon') as kolonne_type,
               lenketekst
        FROM ai_metadata_kolonner WHERE id = '${esc(kolId)}'
      `, 1);

      return reply.send(rows[0]);
    },
  );

  // POST /api/admin/metadata/views/:id/eksempler — legg til eksempelspørsmål
  fastify.post<{ Params: { id: string }; Body: { spørsmål?: string; sql_eksempel?: string } }>(
    '/api/admin/metadata/views/:id/eksempler',
    { preHandler: [requireBruker, requireAdmin] },
    async (request, reply) => {
      const { id } = request.params;
      const { spørsmål, sql_eksempel } = request.body;

      const rows = await queryAzureSQL(`
        INSERT INTO ai_metadata_eksempler (view_id, spørsmål, sql_eksempel)
        OUTPUT INSERTED.id, INSERTED.view_id, INSERTED.spørsmål, INSERTED.sql_eksempel
        VALUES (
          '${esc(id)}',
          ${spørsmål ? `'${esc(spørsmål)}'` : 'NULL'},
          ${sql_eksempel ? `'${esc(sql_eksempel)}'` : 'NULL'}
        )
      `, 1);

      return reply.status(201).send(rows[0]);
    },
  );

  // DELETE /api/admin/metadata/views/:id/eksempler/:eksId — fjern eksempelspørsmål
  fastify.delete<{ Params: { id: string; eksId: string } }>(
    '/api/admin/metadata/views/:id/eksempler/:eksId',
    { preHandler: [requireBruker, requireAdmin] },
    async (request, reply) => {
      await executeAzureSQL(`
        DELETE FROM ai_metadata_eksempler WHERE id = '${esc(request.params.eksId)}'
      `);
      return reply.status(204).send();
    },
  );

  // GET /api/admin/metadata/views/:id/regler — hent regler for et view
  fastify.get<{ Params: { id: string } }>(
    '/api/admin/metadata/views/:id/regler',
    { preHandler: [requireBruker, requireAdmin] },
    async (request, reply) => {
      const { id } = request.params;
      const rows = await queryAzureSQL(`
        SELECT id, view_id, regel, opprettet
        FROM ai_metadata_regler
        WHERE view_id = '${esc(id)}'
        ORDER BY opprettet
      `);
      return reply.send(rows);
    },
  );

  // POST /api/admin/metadata/views/:id/regler — legg til regel
  fastify.post<{ Params: { id: string }; Body: { regel: string } }>(
    '/api/admin/metadata/views/:id/regler',
    { preHandler: [requireBruker, requireAdmin] },
    async (request, reply) => {
      const { id } = request.params;
      const { regel } = request.body;

      const rows = await queryAzureSQL(`
        INSERT INTO ai_metadata_regler (view_id, regel)
        OUTPUT INSERTED.id, INSERTED.view_id, INSERTED.regel
        VALUES ('${esc(id)}', '${esc(regel)}')
      `, 1);

      return reply.status(201).send(rows[0]);
    },
  );

  // DELETE /api/admin/metadata/views/:id/regler/:regelId — fjern regel
  fastify.delete<{ Params: { id: string; regelId: string } }>(
    '/api/admin/metadata/views/:id/regler/:regelId',
    { preHandler: [requireBruker, requireAdmin] },
    async (request, reply) => {
      await executeAzureSQL(`
        DELETE FROM ai_metadata_regler WHERE id = '${esc(request.params.regelId)}'
      `);
      return reply.status(204).send();
    },
  );

  // GET /api/admin/metadata/views/:id/rapporter — hent rapporter koblet til view
  fastify.get<{ Params: { id: string } }>(
    '/api/admin/metadata/views/:id/rapporter',
    { preHandler: [requireBruker, requireAdmin] },
    async (request, reply) => {
      const rows = await queryAzureSQL(`
        SELECT rapport_id, prioritet
        FROM ai_rapport_view_kobling
        WHERE view_id = '${esc(request.params.id)}'
        ORDER BY prioritet
      `);
      return reply.send(rows);
    },
  );

  // GET /api/admin/metadata/rapport/:rapportId/views — hent views koblet til rapport
  fastify.get<{ Params: { rapportId: string } }>(
    '/api/admin/metadata/rapport/:rapportId/views',
    { preHandler: [requireBruker, requireAdmin] },
    async (request, reply) => {
      const { rapportId } = request.params;
      fastify.log.info(`[metadata] GET rapport/${rapportId}/views`);
      try {
        const rows = await queryAzureSQL(`
          SELECT k.view_id, k.prioritet,
                 v.schema_name, v.view_name, v.visningsnavn, v.beskrivelse, v.område
          FROM ai_rapport_view_kobling k
          JOIN ai_metadata_views v ON k.view_id = v.id
          WHERE k.rapport_id = '${esc(rapportId)}'
          ORDER BY k.prioritet
        `);
        fastify.log.info(`[metadata] GET rapport/${rapportId}/views → ${rows.length} rader`);
        return reply.send(rows);
      } catch (err) {
        fastify.log.error(`[metadata] GET rapport/${rapportId}/views feilet: ${err}`);
        return reply.status(500).send({ error: 'Kunne ikke hente koblinger', details: String(err) });
      }
    },
  );

  // POST /api/admin/metadata/rapport/:rapportId/views — koble view til rapport
  fastify.post<{ Params: { rapportId: string }; Body: { viewId: string; prioritet?: number } }>(
    '/api/admin/metadata/rapport/:rapportId/views',
    { preHandler: [requireBruker, requireAdmin] },
    async (request, reply) => {
      const { rapportId } = request.params;
      const { viewId, prioritet = 0 } = request.body;
      fastify.log.info(`[metadata] POST rapport/${rapportId}/views viewId=${viewId} prioritet=${prioritet}`);
      try {
        await executeAzureSQL(`
          IF NOT EXISTS (
            SELECT 1 FROM ai_rapport_view_kobling
            WHERE rapport_id = '${esc(rapportId)}' AND view_id = '${esc(viewId)}'
          )
          INSERT INTO ai_rapport_view_kobling (rapport_id, view_id, prioritet)
          VALUES ('${esc(rapportId)}', '${esc(viewId)}', ${Number(prioritet)})
        `);
        fastify.log.info(`[metadata] POST rapport/${rapportId}/views OK`);
        return reply.status(201).send({ rapport_id: rapportId, view_id: viewId, prioritet });
      } catch (err) {
        fastify.log.error(`[metadata] POST rapport/${rapportId}/views feilet: ${err}`);
        return reply.status(500).send({ error: 'Kunne ikke lagre kobling', details: String(err) });
      }
    },
  );

  // DELETE /api/admin/metadata/rapport/:rapportId/views/:viewId — fjern kobling
  fastify.delete<{ Params: { rapportId: string; viewId: string } }>(
    '/api/admin/metadata/rapport/:rapportId/views/:viewId',
    { preHandler: [requireBruker, requireAdmin] },
    async (request, reply) => {
      const { rapportId, viewId } = request.params;
      fastify.log.info(`[metadata] DELETE rapport/${rapportId}/views/${viewId}`);
      try {
        await executeAzureSQL(`
          DELETE FROM ai_rapport_view_kobling
          WHERE rapport_id = '${esc(rapportId)}' AND view_id = '${esc(viewId)}'
        `);
        fastify.log.info(`[metadata] DELETE rapport/${rapportId}/views/${viewId} OK`);
        return reply.status(204).send();
      } catch (err) {
        fastify.log.error(`[metadata] DELETE rapport/${rapportId}/views/${viewId} feilet: ${err}`);
        return reply.status(500).send({ error: 'Kunne ikke fjerne kobling', details: String(err) });
      }
    },
  );
}

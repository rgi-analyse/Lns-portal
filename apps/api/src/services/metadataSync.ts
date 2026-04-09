import { queryAzureSQL, executeAzureSQL } from './azureSqlService';

const sanitize = (name: string): string => name.replace(/[^a-zA-Z0-9_æøåÆØÅ]/g, '');
const esc = (val: string): string => val.replace(/'/g, "''");

export interface MetadataSyncResult {
  view: string;
  kolonner: number;
  eksempelVerdier: number;
}

export async function syncViewColumns(
  viewId: string,
  schemaName: string,
  viewName: string,
): Promise<MetadataSyncResult> {
  const s = sanitize(schemaName);
  const v = sanitize(viewName);

  const kolonner = await queryAzureSQL(`
    SELECT COLUMN_NAME, DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = '${esc(schemaName)}' AND TABLE_NAME = '${esc(viewName)}'
    ORDER BY ORDINAL_POSITION
  `, 500);

  const tekstTyper   = new Set(['varchar', 'nvarchar', 'char', 'nchar', 'text', 'ntext']);
  const measureTyper = new Set(['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric', 'float', 'real', 'money', 'smallmoney']);
  const datoTyper    = new Set(['date', 'datetime', 'datetime2', 'smalldatetime', 'time', 'datetimeoffset']);
  let eksempelVerdierCount = 0;

  function detectKolonneType(kolNavn: string, datatype: string): string {
    const dt = datatype.toLowerCase();
    if (measureTyper.has(dt)) return 'measure';
    if (datoTyper.has(dt)) return 'dato';
    if (/^id$/i.test(kolNavn) || /id$/i.test(kolNavn) || /_id$/i.test(kolNavn) || /kode$/i.test(kolNavn) || /nr$/i.test(kolNavn)) return 'id';
    return 'dimensjon';
  }

  for (let i = 0; i < kolonner.length; i++) {
    const kolNavn = kolonner[i]['COLUMN_NAME'] as string;
    const datatype = (kolonner[i]['DATA_TYPE'] as string) ?? '';
    const safeKol = sanitize(kolNavn);
    const kolonne_type = detectKolonneType(kolNavn, datatype);

    let eksempelVerdier: string | null = null;

    if (tekstTyper.has(datatype.toLowerCase())) {
      try {
        const countRes = await queryAzureSQL(`
          SELECT TOP 1 COUNT(DISTINCT [${safeKol}]) as antall
          FROM [${s}].[${v}]
        `, 1);
        const antall = Number(countRes[0]?.['antall'] ?? 999);
        if (antall > 0 && antall < 20) {
          const verdier = await queryAzureSQL(`
            SELECT DISTINCT [${safeKol}] as verdi
            FROM [${s}].[${v}]
            WHERE [${safeKol}] IS NOT NULL
            ORDER BY [${safeKol}]
          `, 20);
          eksempelVerdier = verdier.map(r => String(r['verdi'])).join(', ');
          eksempelVerdierCount++;
        }
      } catch {
        // Ignorer feil for enkeltkolonner
      }
    }

    const existing = await queryAzureSQL(`
      SELECT id FROM ai_metadata_kolonner
      WHERE view_id = '${esc(viewId)}' AND kolonne_navn = '${esc(kolNavn)}'
    `, 1);

    const verdierSql = eksempelVerdier !== null ? `'${esc(eksempelVerdier)}'` : 'NULL';

    if (existing.length === 0) {
      await executeAzureSQL(`
        INSERT INTO ai_metadata_kolonner (view_id, kolonne_navn, datatype, eksempel_verdier, sort_order, kolonne_type)
        VALUES ('${esc(viewId)}', '${esc(kolNavn)}', '${esc(datatype)}', ${verdierSql}, ${i}, '${esc(kolonne_type)}')
      `);
    } else {
      await executeAzureSQL(`
        UPDATE ai_metadata_kolonner
        SET datatype = '${esc(datatype)}'
            ${eksempelVerdier !== null ? `, eksempel_verdier = ${verdierSql}` : ''}
        WHERE view_id = '${esc(viewId)}' AND kolonne_navn = '${esc(kolNavn)}'
      `);
    }
  }

  // Slett kolonner som ikke lenger finnes i viewet
  const kolonnerFraView = new Set(kolonner.map(k => k['COLUMN_NAME'] as string));
  const eksisterende = await queryAzureSQL(`
    SELECT kolonne_navn FROM ai_metadata_kolonner
    WHERE view_id = '${esc(viewId)}'
  `, 500);
  const utgåtte = eksisterende
    .map(k => k['kolonne_navn'] as string)
    .filter(navn => !kolonnerFraView.has(navn));

  if (utgåtte.length > 0) {
    console.log(`[MetadataSync] sletter ${utgåtte.length} utgåtte kolonner:`, utgåtte);
    const inClause = utgåtte.map(n => `'${esc(n)}'`).join(', ');
    await executeAzureSQL(`
      DELETE FROM ai_metadata_kolonner
      WHERE view_id = '${esc(viewId)}' AND kolonne_navn IN (${inClause})
    `);
  }

  await executeAzureSQL(`
    UPDATE ai_metadata_views
    SET sist_synkronisert = GETDATE()
    WHERE id = '${esc(viewId)}'
  `);

  return { view: `${schemaName}.${viewName}`, kolonner: kolonner.length, eksempelVerdier: eksempelVerdierCount };
}

export async function syncAllViews(): Promise<MetadataSyncResult[]> {
  const views = await queryAzureSQL(`
    SELECT id, schema_name, view_name
    FROM ai_metadata_views
    WHERE er_aktiv = 1
    ORDER BY schema_name, view_name
  `, 100);

  const results: MetadataSyncResult[] = [];

  for (const view of views) {
    try {
      const result = await syncViewColumns(
        view['id'] as string,
        view['schema_name'] as string,
        view['view_name'] as string,
      );
      results.push(result);
      console.log(`[MetadataSync] Synkronisert: ${result.view} — ${result.kolonner} kolonner`);
    } catch (err) {
      console.error(`[MetadataSync] Feil: ${view['schema_name']}.${view['view_name']}:`, err);
    }
  }

  return results;
}

export async function discoverNewViews(): Promise<{ schema_name: string; view_name: string }[]> {
  const allViews = await queryAzureSQL(`
    SELECT TABLE_SCHEMA as schema_name, TABLE_NAME as view_name
    FROM INFORMATION_SCHEMA.VIEWS
    WHERE TABLE_SCHEMA = 'ai_gold'
    ORDER BY TABLE_NAME
  `, 500);

  const existing = await queryAzureSQL(`
    SELECT schema_name, view_name FROM ai_metadata_views
  `, 500);

  const existingSet = new Set(
    existing.map(r => `${r['schema_name']}.${r['view_name']}`),
  );

  return allViews
    .filter(v => !existingSet.has(`${v['schema_name']}.${v['view_name']}`))
    .map(v => ({
      schema_name: v['schema_name'] as string,
      view_name: v['view_name'] as string,
    }));
}

/**
 * CLI: legg til en slicer-indekserings-konfig i ai_slicer_indeksering.
 *
 * Interaktiv som default. Kan også drives helt eller delvis fra CLI-flagg
 * for scripting:
 *
 *   npx tsx scripts/leggTilSlicerIndeks.ts \
 *     --rapport-id <uuid> \
 *     --slicer-tittel Kunder \
 *     --type basic \
 *     --tabell "core Dim_Customer_LNS" \
 *     --verdi-kolonne Kunde \
 *     --indekser --yes
 *
 * Ufullstendig flagg-sett → spør for resten interaktivt.
 */

import 'dotenv/config';
import { parseArgs } from 'node:util';
import { select, input, confirm } from '@inquirer/prompts';
import { prisma } from '../src/lib/prisma';
import { utførDax } from '../src/services/pbiQueryService';
import { indekserSlicer } from '../src/services/slicerIndekseringService';

interface Args {
  'rapport-id'?:       string;
  'slicer-tittel'?:    string;
  'type'?:             string;
  'tabell'?:           string;
  'verdi-kolonne'?:    string;
  'forelder-kolonne'?: string;
  'indekser'?:         boolean;
  'yes'?:              boolean;
}

function parseFlagg(): Args {
  const { values } = parseArgs({
    options: {
      'rapport-id':       { type: 'string' },
      'slicer-tittel':    { type: 'string' },
      'type':             { type: 'string' },
      'tabell':           { type: 'string' },
      'verdi-kolonne':    { type: 'string' },
      'forelder-kolonne': { type: 'string' },
      'indekser':         { type: 'boolean' },
      'yes':              { type: 'boolean' },
    },
    strict: false,
  });
  return values as Args;
}

async function velgRapport(forhåndsvalgt?: string): Promise<{
  id:          string;
  navn:        string;
  pbiWorkspaceId: string;
  pbiDatasetId:   string;
}> {
  const rapporter = await prisma.rapport.findMany({
    where:  { erAktiv: true },
    select: { id: true, navn: true, område: true, pbiWorkspaceId: true, pbiDatasetId: true },
    orderBy: { navn: 'asc' },
  });
  if (forhåndsvalgt) {
    const r = rapporter.find((r) => r.id === forhåndsvalgt);
    if (!r) throw new Error(`Rapport-id ${forhåndsvalgt} ikke funnet eller inaktiv.`);
    console.log(`✓ Rapport: ${r.navn} (${r.område ?? 'uten område'})`);
    return r;
  }
  const valg = await select({
    message: 'Velg rapport:',
    choices: rapporter.map((r) => ({
      name:  `${r.navn}${r.område ? ` — ${r.område}` : ''}`,
      value: r.id,
    })),
    pageSize: 15,
  });
  return rapporter.find((r) => r.id === valg)!;
}

async function velgTabell(
  workspaceId: string,
  datasetId:   string,
  forhåndsvalgt?: string,
): Promise<{ tabell: string; kolonner: string[] }> {
  const hentKolonner = async (tabell: string): Promise<string[]> => {
    const respons = await utførDax({
      workspaceId, datasetId,
      dax: `EVALUATE TOPN(1, '${tabell}')`,
    });
    if (respons.rader.length === 0) {
      throw new Error(`Tabellen '${tabell}' returnerte 0 rader — kan ikke utlede kolonner.`);
    }
    // Kolonnenavn kommer som 'TabellNavn[ColumnName]' — strip prefiks
    return Object.keys(respons.rader[0]).map((k) => {
      const match = k.match(/\[([^\]]+)\]$/);
      return match ? match[1] : k;
    });
  };

  if (forhåndsvalgt) {
    const kolonner = await hentKolonner(forhåndsvalgt);
    console.log(`✓ Tabell: '${forhåndsvalgt}' (${kolonner.length} kolonner)`);
    return { tabell: forhåndsvalgt, kolonner };
  }

  // Interaktivt: be bruker skrive tabellnavn, valider via TOPN
  while (true) {
    const tabell = await input({
      message: 'Tabellnavn (Power BI dataset, eks. "core Dim_Customer_LNS"):',
      validate: (v) => v.trim().length > 0 || 'Påkrevd',
    });
    try {
      const kolonner = await hentKolonner(tabell.trim());
      console.log(`✓ ${kolonner.length} kolonner funnet i '${tabell.trim()}'`);
      return { tabell: tabell.trim(), kolonner };
    } catch (err) {
      console.error(`Klarte ikke å lese tabellen: ${err instanceof Error ? err.message : err}`);
      const igjen = await confirm({ message: 'Prøv et annet navn?', default: true });
      if (!igjen) throw new Error('Avbrutt');
    }
  }
}

async function main(): Promise<void> {
  const args = parseFlagg();

  console.log('═══════════════════════════════════════════════════');
  console.log('LEGG TIL SLICER-INDEKSERING');
  console.log('═══════════════════════════════════════════════════\n');

  const rapport = await velgRapport(args['rapport-id']);

  const slicerTittel = args['slicer-tittel'] ?? await input({
    message: 'Slicer-tittel (matchende det frontend sender, eks. "Kunder"):',
    validate: (v) => v.trim().length > 0 || 'Påkrevd',
  });

  const type = args['type'] ?? await select({
    message: 'Slicer-type:',
    choices: [
      { name: 'basic — én kolonne (f.eks. leverandør, kunde, status)', value: 'basic' },
      { name: 'hierarchy — to nivåer (f.eks. Hovedprosjekt → Prosjekt)', value: 'hierarchy' },
    ],
  });
  if (type !== 'basic' && type !== 'hierarchy') {
    throw new Error(`Ugyldig type: ${type}`);
  }

  const { tabell, kolonner } = await velgTabell(
    rapport.pbiWorkspaceId, rapport.pbiDatasetId, args['tabell'],
  );

  const verdiKolonne = args['verdi-kolonne'] ?? await select({
    message: 'Verdi-kolonne (det brukeren faktisk velger i sliceren):',
    choices: kolonner.map((k) => ({ name: k, value: k })),
    pageSize: 15,
  });
  if (!kolonner.includes(verdiKolonne)) {
    throw new Error(`Verdi-kolonnen "${verdiKolonne}" finnes ikke i tabellen '${tabell}'`);
  }

  let forelderKolonne: string | null = null;
  if (type === 'hierarchy') {
    forelderKolonne = args['forelder-kolonne'] ?? await select({
      message: 'Forelder-kolonne (gruppering, f.eks. Hovedprosjekt):',
      choices: kolonner.filter((k) => k !== verdiKolonne).map((k) => ({ name: k, value: k })),
      pageSize: 15,
    });
    if (forelderKolonne && !kolonner.includes(forelderKolonne)) {
      throw new Error(`Forelder-kolonnen "${forelderKolonne}" finnes ikke i tabellen`);
    }
  }

  // Generer DAX
  const daxQuery = type === 'basic'
    ? `EVALUATE\nDISTINCT('${tabell}'[${verdiKolonne}])\nORDER BY [${verdiKolonne}]`
    : `EVALUATE\nSUMMARIZE(\n  '${tabell}',\n  '${tabell}'[${forelderKolonne}],\n  '${tabell}'[${verdiKolonne}]\n)\nORDER BY [${forelderKolonne}], [${verdiKolonne}]`;

  console.log('\n--- Generert DAX ---');
  console.log(daxQuery);
  console.log('--------------------\n');

  // Preview
  console.log('Kjører DAX for preview...');
  const preview = await utførDax({
    workspaceId: rapport.pbiWorkspaceId,
    datasetId:   rapport.pbiDatasetId,
    dax:         daxQuery,
  });
  console.log(`\n${preview.rader.length} rader (${preview.spørringMs}ms). Første 5:`);
  preview.rader.slice(0, 5).forEach((rad, i) => {
    console.log(`  ${i + 1}. ${JSON.stringify(rad)}`);
  });

  // Bygg fully-qualified kolonne-referanser slik service forventer
  const verdiKolonneFq    = `${tabell}[${verdiKolonne}]`;
  const forelderKolonneFq = forelderKolonne ? `${tabell}[${forelderKolonne}]` : null;

  // Bekreft
  const skalLagre = args['yes'] ?? await confirm({
    message: 'Lagre konfig i ai_slicer_indeksering?',
    default: true,
  });
  if (!skalLagre) {
    console.log('Avbrutt — ingenting lagret.');
    return;
  }

  // Upsert (idempotent på tenant + rapport_id + slicer_tittel)
  const tenant = 'lns'; // TODO: hent fra rapport hvis vi støtter flere tenants
  const lagret = await prisma.slicerIndeksering.upsert({
    where: { tenant_rapport_id_slicer_tittel: { tenant, rapport_id: rapport.id, slicer_tittel: slicerTittel } },
    create: {
      tenant,
      rapport_id:       rapport.id,
      workspace_id:     rapport.pbiWorkspaceId,
      dataset_id:       rapport.pbiDatasetId,
      slicer_tittel:    slicerTittel,
      slicer_type:      type,
      dax_query:        daxQuery,
      forelder_kolonne: forelderKolonneFq,
      verdi_kolonne:    verdiKolonneFq,
      er_aktiv:         true,
    },
    update: {
      workspace_id:     rapport.pbiWorkspaceId,
      dataset_id:       rapport.pbiDatasetId,
      slicer_type:      type,
      dax_query:        daxQuery,
      forelder_kolonne: forelderKolonneFq,
      verdi_kolonne:    verdiKolonneFq,
      er_aktiv:         true,
    },
  });
  console.log(`\n✓ Konfig lagret. ID: ${lagret.id}`);

  // Tilby indeksering
  const skalIndeksere = args['indekser'] ?? await confirm({
    message: 'Indeksere nå?',
    default: true,
  });
  if (skalIndeksere) {
    console.log('\nIndekserer...');
    const r = await indekserSlicer(lagret.id);
    console.log(`\n✓ Indeksert: ${r.antall_rader} rader (DAX ${r.spørrings_ms}ms + indeks ${r.indekserings_ms}ms)`);
  }
}

main()
  .catch((err) => {
    console.error('\nFEIL:', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

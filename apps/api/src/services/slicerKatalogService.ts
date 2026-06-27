/**
 * Domene-tjeneste for slicer-katalog-indeksen i Azure AI Search.
 *
 * Indeks: synapse-slicer-katalog
 *   - Multi-tenant (filterable på tenant-felt)
 *   - Norsk-bevisst søk via no.microsoft-analyzer på primær verdi
 *   - Sekundær lowercase-tokenisering for eksakte/prefiks-treff
 *   - Synonymer som indekserbar collection (f.eks. "BDO" → "BDO AS")
 *
 * ID-format: `${tenant}_${rapport_id}_${slicer_tittel}_${verdi-hash}`
 *   verdi-hash = sha1(verdi) base64url, første 8 chars.
 */

import { createHash } from 'node:crypto';
import type { SearchIndex } from '@azure/search-documents';
import { getSearchService } from './searchService';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';

export const SLICER_INDEKS_NAVN = 'synapse-slicer-katalog';

/**
 * Markør i forelder_verdi-feltet for å skille topp-nivå-rader (hierarki)
 * fra barn-rader. Indekserings­tjenesten skriver én topp-rad per DISTINCT
 * forelder-verdi med denne markøren; matchEnTopp filtrerer mot den.
 * Verdi: ikke-tom streng som ikke kan kollidere med ekte forelder-navn.
 */
export const TOPP_MARKOR = '__topp__';

// retrievable er default true i SDK v13 — feltet er ikke en del av SimpleField-typen.
// Bruk hidden: true for å unngå at et felt returneres i søkesvar.
const indeksDefinisjon: SearchIndex = {
  name: SLICER_INDEKS_NAVN,
  fields: [
    { name: 'id',              type: 'Edm.String', key: true,         filterable: true                                },
    { name: 'tenant',          type: 'Edm.String', filterable: true,  facetable:  true                                },
    { name: 'rapport_id',      type: 'Edm.String', filterable: true                                                   },
    { name: 'slicer_tittel',   type: 'Edm.String', filterable: true                                                   },
    { name: 'slicer_type',     type: 'Edm.String', filterable: true                                                   },
    { name: 'verdi',           type: 'Edm.String', searchable: true,  analyzerName: 'nb.microsoft'                    },
    { name: 'verdi_lowercase', type: 'Edm.String', searchable: true,  analyzerName: 'standard.lucene'                 },
    { name: 'forelder_verdi',  type: 'Edm.String', filterable: true                                                   },
    { name: 'synonymer',       type: 'Collection(Edm.String)',        searchable: true                                },
    { name: 'oppdatert',       type: 'Edm.DateTimeOffset',            filterable: true, sortable: true                },
  ],
};

export interface SlicerVerdi {
  tenant:         string;
  rapport_id:     string;
  slicer_tittel:  string;
  slicer_type:    'basic' | 'hierarchy';
  verdi:          string;
  forelder_verdi?: string;
  synonymer?:     string[];
}

export interface SlicerSøkForespørsel {
  tenant:         string;
  rapport_id:     string;
  slicer_tittel:  string;
  søketerm:       string;
  forelder_verdi?: string;
  top?:           number;
}

export interface SlicerSøkTreff {
  verdi:           string;
  forelder_verdi?: string;
  score:           number;
}

export interface SlicerSøkResultat {
  treff:    SlicerSøkTreff[];
  søketerm: string;
}

interface IndeksertDokument extends Record<string, unknown> {
  id:              string;
  tenant:          string;
  rapport_id:      string;
  slicer_tittel:   string;
  slicer_type:     'basic' | 'hierarchy';
  verdi:           string;
  verdi_lowercase: string;
  forelder_verdi:  string | null;
  synonymer:       string[];
  oppdatert:       string;
}

// ── Hjelpere ───────────────────────────────────────────────────────────

/** Sanitiser komponent for bruk i Azure Search-document-key.
 *  Tillatte tegn: A-Za-z0-9_-=. Alt annet erstattes med _. */
function safeKomponent(s: string): string {
  return s.replace(/[^A-Za-z0-9_\-=]/g, '_');
}

function lagDokumentId(
  tenant:        string,
  rapportId:     string,
  slicerTittel:  string,
  verdi:         string,
): string {
  const hash = createHash('sha1').update(verdi).digest('base64url').slice(0, 8);
  return [
    safeKomponent(tenant),
    safeKomponent(rapportId),
    safeKomponent(slicerTittel),
    hash,
  ].join('_');
}

/** Escape enkelt-anførselstegn for OData filter-uttrykk. */
function escapeOData(s: string): string {
  return s.replace(/'/g, "''");
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Slett alle dokumenter i synapse-slicer-katalog som matcher tenant + rapport_id +
 * slicer_tittel. Brukes ved DELETE av en konfig slik at indeksen ikke står igjen
 * med foreldreløse rader. Pagination brukes for å håndtere store slicere
 * (Leverandør har 4 409 dokumenter).
 *
 * Returnerer antall slettede dokumenter.
 */
export async function slettAlleForSlicer(
  tenant:       string,
  rapportId:    string,
  slicerTittel: string,
): Promise<number> {
  const service = getSearchService();
  const finnes  = await service.finnesIndeks(SLICER_INDEKS_NAVN);
  if (!finnes) return 0;

  const filter =
    `tenant eq '${escapeOData(tenant)}' and ` +
    `rapport_id eq '${escapeOData(rapportId)}' and ` +
    `slicer_tittel eq '${escapeOData(slicerTittel)}'`;

  const ider: string[] = [];
  let skip = 0;
  const sideStørrelse = 1000;
  while (true) {
    const respons = await service.søk<{ id: string }>(SLICER_INDEKS_NAVN, {
      searchText: '*',
      filter,
      top:    sideStørrelse,
      skip,
      select: ['id'],
    });
    if (respons.treff.length === 0) break;
    ider.push(...respons.treff.map((t) => t.document.id));
    if (respons.treff.length < sideStørrelse) break;
    skip += sideStørrelse;
    // Azure Search støtter maks 100 000 i skip — utenfor scope for slicer-størrelser
  }

  if (ider.length === 0) return 0;

  // Slett i batcher for å holde oss under request-grense
  const batch = 1000;
  for (let i = 0; i < ider.length; i += batch) {
    await service.slettDokumenter(SLICER_INDEKS_NAVN, 'id', ider.slice(i, i + batch));
  }
  logger.debug(`[slicerKatalog] slettet ${ider.length} dokument(er) for tenant=${tenant} rapport=${rapportId} slicer="${slicerTittel}"`);
  return ider.length;
}

/** Idempotent: oppretter indeksen hvis den ikke finnes. */
export async function sikreIndeksFinnes(): Promise<void> {
  const service = getSearchService();
  const finnes  = await service.finnesIndeks(SLICER_INDEKS_NAVN);
  if (finnes) {
    logger.debug(`[slicerKatalog] indeks "${SLICER_INDEKS_NAVN}" finnes allerede`);
    return;
  }
  await service.opprettIndeks(indeksDefinisjon);
}

export async function indekserVerdier(verdier: SlicerVerdi[]): Promise<void> {
  if (verdier.length === 0) return;
  const nå = new Date().toISOString();
  const dokumenter: IndeksertDokument[] = verdier.map((v) => ({
    id:              lagDokumentId(v.tenant, v.rapport_id, v.slicer_tittel, v.verdi),
    tenant:          v.tenant,
    rapport_id:      v.rapport_id,
    slicer_tittel:   v.slicer_tittel,
    slicer_type:     v.slicer_type,
    verdi:           v.verdi,
    verdi_lowercase: v.verdi.toLowerCase(),
    forelder_verdi:  v.forelder_verdi ?? null,
    synonymer:       v.synonymer ?? [],
    oppdatert:       nå,
  }));
  await getSearchService().indekserDokumenter(SLICER_INDEKS_NAVN, dokumenter);
}

/**
 * Returnerer true hvis sliceren har en aktiv konfig i ai_slicer_indeksering
 * OG er blitt indeksert minst én gang. Brukes av validator-laget for å
 * avgjøre om AI Search-fallback er tilgjengelig for denne sliceren.
 */
export async function erIndeksert(
  tenant:        string,
  rapportId:     string,
  slicerTittel:  string,
): Promise<{ indeksert: boolean; sistIndeksert: Date | null; antallDokumenter: number | null }> {
  const konfig = await prisma.slicerIndeksering.findUnique({
    where:  { tenant_rapport_id_slicer_tittel: { tenant, rapport_id: rapportId, slicer_tittel: slicerTittel } },
    select: { er_aktiv: true, sist_indeksert: true, sist_antall_rader: true },
  });
  if (!konfig) {
    logger.debug(`[search-katalog] erIndeksert: ingen konfig for tenant=${tenant} rapport=${rapportId} tittel="${slicerTittel}"`);
    // Hjelp diagnose: list eksisterende konfig-tittel-er for denne rapporten
    const alleForRapport = await prisma.slicerIndeksering.findMany({
      where:  { tenant, rapport_id: rapportId },
      select: { slicer_tittel: true, er_aktiv: true },
    });
    if (alleForRapport.length > 0) {
      logger.debug(`[search-katalog] eksisterende titler for samme rapport: ${alleForRapport.map((k) => `"${k.slicer_tittel}"${k.er_aktiv ? '' : '(inaktiv)'}`).join(', ')}`);
    }
    return { indeksert: false, sistIndeksert: null, antallDokumenter: null };
  }
  if (!konfig.er_aktiv) {
    logger.debug(`[search-katalog] erIndeksert: konfig for "${slicerTittel}" finnes men er inaktiv`);
    return { indeksert: false, sistIndeksert: null, antallDokumenter: null };
  }
  if (!konfig.sist_indeksert) {
    logger.debug(`[search-katalog] erIndeksert: konfig for "${slicerTittel}" finnes, aktiv, men aldri indeksert`);
    return { indeksert: false, sistIndeksert: null, antallDokumenter: null };
  }
  return {
    indeksert:        true,
    sistIndeksert:    konfig.sist_indeksert,
    antallDokumenter: konfig.sist_antall_rader,
  };
}

/**
 * Velg blant AI Search-treff basert på relevans og søketerm:
 *   1. Eksakt streng-match (case-insensitive) vinner alltid → unique
 *   2. Treff under absolutt minimum (score < 1.0) avvises som støy
 *   3. Treff under relativ terskel (40 % av #1 score) regnes ikke som
 *      reelle konkurrenter — filtreres bort fra ambiguous-listen
 *   4. Etter filtrering: 0 → none, 1 → unique, 2+ → ambiguous
 *
 * Eksempel — "BDO" returnerer:
 *   BDO AS              13.90  ← over terskel (>= 5.56)
 *   BDO Advokater AS    11.74  ← over terskel
 *   AS Fjellsprengning   1.04  ← under relativ terskel, droppet
 *   FNC AS               0.99  ← under absolutt minimum, droppet
 *   → ambiguous med [BDO AS, BDO Advokater AS]
 */
export type TreffVurdering =
  | { type: 'unique';    treff: string }
  | { type: 'ambiguous'; alle:  SlicerSøkTreff[] }
  | { type: 'none' };

export function velgFraTreff(
  treff:    SlicerSøkTreff[],
  søketerm: string,
): TreffVurdering {
  if (treff.length === 0) return { type: 'none' };

  // 1. Eksakt streng-match overstyrer alt
  const søketermLav = søketerm.toLowerCase();
  const eksakt = treff.find((t) => t.verdi.toLowerCase() === søketermLav);
  if (eksakt) return { type: 'unique', treff: eksakt.verdi };

  // 2. Absolutt minimum — avvis tilfeldig støy fra delvis ord-match
  const oversAbsolutt = treff.filter((t) => t.score >= 1.0);
  if (oversAbsolutt.length === 0) return { type: 'none' };

  // 3. Relativ terskel — behold kun treff som er minst 40 % av top-score
  const topScore   = oversAbsolutt[0].score;
  const relevante  = oversAbsolutt.filter((t) => t.score >= topScore * 0.4);

  if (relevante.length === 1) return { type: 'unique', treff: relevante[0].verdi };
  return { type: 'ambiguous', alle: relevante };
}

export async function søk(forespørsel: SlicerSøkForespørsel): Promise<SlicerSøkResultat> {
  const service = getSearchService();

  const filterDeler = [
    `tenant eq '${escapeOData(forespørsel.tenant)}'`,
    `rapport_id eq '${escapeOData(forespørsel.rapport_id)}'`,
    `slicer_tittel eq '${escapeOData(forespørsel.slicer_tittel)}'`,
  ];
  if (forespørsel.forelder_verdi) {
    filterDeler.push(`forelder_verdi eq '${escapeOData(forespørsel.forelder_verdi)}'`);
  }

  const respons = await service.søk<IndeksertDokument>(SLICER_INDEKS_NAVN, {
    searchText:   forespørsel.søketerm,
    filter:       filterDeler.join(' and '),
    top:          forespørsel.top ?? 5,
    searchFields: ['verdi', 'verdi_lowercase', 'synonymer'],
    select:       ['verdi', 'forelder_verdi'],
    searchMode:   'any',
  });

  return {
    søketerm: forespørsel.søketerm,
    treff: respons.treff.map((t) => ({
      verdi:          t.document.verdi,
      forelder_verdi: t.document.forelder_verdi ?? undefined,
      score:          t.score,
    })),
  };
}

/**
 * Henter komplett verdi-liste for en hierarki-slicer fra Azure Search-indeksen.
 * Bypasser frontend-state (som kan være filtrert av PBI-søk eller kollapset).
 *
 * Returnerer null hvis sliceren ikke er indeksert eller indeksen er tom for
 * denne sliceren — kaller skal da falle tilbake til frontend-state.
 *
 * Krever at sliceren er re-indeksert med TOPP_MARKOR-konvensjonen (jf. Steg
 * fix/hierarki-slicer-toppniva-ai-search).
 */
export async function hentKompleteSlicerVerdier(
  tenant:       string,
  rapportId:    string,
  slicerTittel: string,
): Promise<{ topp: string[]; barn: Record<string, string[]> } | null> {
  const service = getSearchService();
  const finnes  = await service.finnesIndeks(SLICER_INDEKS_NAVN);
  if (!finnes) return null;

  const filter =
    `tenant eq '${escapeOData(tenant)}' and ` +
    `rapport_id eq '${escapeOData(rapportId)}' and ` +
    `slicer_tittel eq '${escapeOData(slicerTittel)}' and ` +
    `slicer_type eq 'hierarchy'`;

  const alleRader: Array<{ verdi: string; forelder_verdi: string | null }> = [];
  let skip = 0;
  const sideStørrelse = 1000;
  // Paginering: hierarki-slicere har sjelden > 1000 verdier, men vi støtter
  // flere sider defensivt.
  while (true) {
    const respons = await service.søk<IndeksertDokument>(SLICER_INDEKS_NAVN, {
      searchText: '*',
      filter,
      top:    sideStørrelse,
      skip,
      select: ['verdi', 'forelder_verdi'],
    });
    if (respons.treff.length === 0) break;
    for (const t of respons.treff) {
      alleRader.push({
        verdi:          t.document.verdi,
        forelder_verdi: t.document.forelder_verdi ?? null,
      });
    }
    if (respons.treff.length < sideStørrelse) break;
    skip += sideStørrelse;
  }

  if (alleRader.length === 0) return null;

  const topp: string[] = [];
  const barn: Record<string, string[]> = {};
  for (const rad of alleRader) {
    if (rad.forelder_verdi === TOPP_MARKOR) {
      topp.push(rad.verdi);
    } else if (rad.forelder_verdi !== null && rad.forelder_verdi !== '') {
      if (!barn[rad.forelder_verdi]) barn[rad.forelder_verdi] = [];
      barn[rad.forelder_verdi].push(rad.verdi);
    }
  }

  return { topp, barn };
}

/**
 * Tilsvarende for basic-slicere: returnerer komplett verdi-liste fra indeksen.
 * Returnerer null hvis ikke indeksert eller tom.
 */
export async function hentKompleteBasicVerdier(
  tenant:       string,
  rapportId:    string,
  slicerTittel: string,
): Promise<string[] | null> {
  const service = getSearchService();
  const finnes  = await service.finnesIndeks(SLICER_INDEKS_NAVN);
  if (!finnes) return null;

  const filter =
    `tenant eq '${escapeOData(tenant)}' and ` +
    `rapport_id eq '${escapeOData(rapportId)}' and ` +
    `slicer_tittel eq '${escapeOData(slicerTittel)}' and ` +
    `slicer_type eq 'basic'`;

  const verdier: string[] = [];
  let skip = 0;
  const sideStørrelse = 1000;
  while (true) {
    const respons = await service.søk<IndeksertDokument>(SLICER_INDEKS_NAVN, {
      searchText: '*',
      filter,
      top:    sideStørrelse,
      skip,
      select: ['verdi'],
    });
    if (respons.treff.length === 0) break;
    verdier.push(...respons.treff.map((t) => t.document.verdi));
    if (respons.treff.length < sideStørrelse) break;
    skip += sideStørrelse;
  }

  return verdier.length === 0 ? null : verdier;
}

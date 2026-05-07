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
import { prisma } from '../lib/prisma';

export const SLICER_INDEKS_NAVN = 'synapse-slicer-katalog';

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

/** Idempotent: oppretter indeksen hvis den ikke finnes. */
export async function sikreIndeksFinnes(): Promise<void> {
  const service = getSearchService();
  const finnes  = await service.finnesIndeks(SLICER_INDEKS_NAVN);
  if (finnes) {
    console.log(`[slicerKatalog] indeks "${SLICER_INDEKS_NAVN}" finnes allerede`);
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
    console.log(`[search-katalog] erIndeksert: ingen konfig for tenant=${tenant} rapport=${rapportId} tittel="${slicerTittel}"`);
    // Hjelp diagnose: list eksisterende konfig-tittel-er for denne rapporten
    const alleForRapport = await prisma.slicerIndeksering.findMany({
      where:  { tenant, rapport_id: rapportId },
      select: { slicer_tittel: true, er_aktiv: true },
    });
    if (alleForRapport.length > 0) {
      console.log(`[search-katalog] eksisterende titler for samme rapport: ${alleForRapport.map((k) => `"${k.slicer_tittel}"${k.er_aktiv ? '' : '(inaktiv)'}`).join(', ')}`);
    }
    return { indeksert: false, sistIndeksert: null, antallDokumenter: null };
  }
  if (!konfig.er_aktiv) {
    console.log(`[search-katalog] erIndeksert: konfig for "${slicerTittel}" finnes men er inaktiv`);
    return { indeksert: false, sistIndeksert: null, antallDokumenter: null };
  }
  if (!konfig.sist_indeksert) {
    console.log(`[search-katalog] erIndeksert: konfig for "${slicerTittel}" finnes, aktiv, men aldri indeksert`);
    return { indeksert: false, sistIndeksert: null, antallDokumenter: null };
  }
  return {
    indeksert:        true,
    sistIndeksert:    konfig.sist_indeksert,
    antallDokumenter: konfig.sist_antall_rader,
  };
}

/**
 * Vurder tvetydighet basert på score-forhold. Default: #1 må være > 1.5x #2.
 * Med kun ett treff er det per definisjon ikke tvetydig.
 */
export function erTvetydig(treff: SlicerSøkTreff[], terskelRatio = 1.5): boolean {
  if (treff.length < 2) return false;
  const førsteScore = treff[0].score;
  const andreScore  = treff[1].score;
  if (andreScore <= 0) return false;
  return førsteScore < terskelRatio * andreScore;
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

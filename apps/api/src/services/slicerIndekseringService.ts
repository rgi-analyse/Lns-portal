/**
 * Indekserings-tjeneste: plumber DAX → AI Search.
 *
 * Leser konfig fra ai_slicer_indeksering, kjører DAX via pbiQueryService,
 * transformerer rader til SlicerVerdi[] og indekserer i synapse-slicer-katalog
 * via slicerKatalogService. Oppdaterer konfig med tidsstempel og rad-antall.
 *
 * Indeksering går i batcher på 500 dokumenter for å unngå å overskride
 * Azure Search request-grense (1000 docs eller 16MB per request).
 */

import { prisma } from '../lib/prisma';
import { utførDax } from './pbiQueryService';
import {
  sikreIndeksFinnes,
  indekserVerdier,
  type SlicerVerdi,
} from './slicerKatalogService';

const BATCH_STØRRELSE = 500;

export interface IndekseringResultat {
  konfig_id:        string;
  slicer_tittel:    string;
  antall_rader:     number;
  spørrings_ms:     number;
  indekserings_ms:  number;
  feil?:            string;
}

/** Indekserer én slicer ut fra lagret konfig. Throw'er ved feil. */
export async function indekserSlicer(konfigId: string): Promise<IndekseringResultat> {
  const konfig = await prisma.slicerIndeksering.findUnique({ where: { id: konfigId } });
  if (!konfig) {
    throw new Error(`Konfig ${konfigId} ikke funnet i ai_slicer_indeksering`);
  }
  if (!konfig.er_aktiv) {
    throw new Error(`Konfig ${konfigId} ("${konfig.slicer_tittel}") er ikke aktiv`);
  }
  if (konfig.slicer_type !== 'basic' && konfig.slicer_type !== 'hierarchy') {
    throw new Error(`Konfig ${konfigId}: ugyldig slicer_type "${konfig.slicer_type}"`);
  }
  if (konfig.slicer_type === 'hierarchy' && !konfig.forelder_kolonne) {
    throw new Error(`Konfig ${konfigId}: hierarchy-slicer mangler forelder_kolonne`);
  }

  console.log(`[indeksering] start "${konfig.slicer_tittel}" (${konfig.slicer_type}) for rapport ${konfig.rapport_id}`);

  // 1. DAX
  const daxResultat = await utførDax({
    workspaceId: konfig.workspace_id,
    datasetId:   konfig.dataset_id,
    dax:         konfig.dax_query,
  });

  // 2. Transformer rader → SlicerVerdi[]
  const verdier: SlicerVerdi[] = [];
  for (const rad of daxResultat.rader) {
    const rådVerdi = rad[konfig.verdi_kolonne];
    if (rådVerdi === null || rådVerdi === undefined || rådVerdi === '') continue;
    const verdi = String(rådVerdi);

    if (konfig.slicer_type === 'hierarchy' && konfig.forelder_kolonne) {
      const rådForelder = rad[konfig.forelder_kolonne];
      if (rådForelder === null || rådForelder === undefined || rådForelder === '') continue;
      verdier.push({
        tenant:         konfig.tenant,
        rapport_id:     konfig.rapport_id,
        slicer_tittel:  konfig.slicer_tittel,
        slicer_type:    'hierarchy',
        verdi,
        forelder_verdi: String(rådForelder),
      });
    } else {
      verdier.push({
        tenant:        konfig.tenant,
        rapport_id:    konfig.rapport_id,
        slicer_tittel: konfig.slicer_tittel,
        slicer_type:   'basic',
        verdi,
      });
    }
  }

  console.log(`[indeksering] "${konfig.slicer_tittel}": ${verdier.length} av ${daxResultat.rader.length} rader klare for indeksering`);

  // 3. Sikre indeks finnes
  await sikreIndeksFinnes();

  // 4. Indekser i batcher
  const tIndeksStart = Date.now();
  for (let i = 0; i < verdier.length; i += BATCH_STØRRELSE) {
    const batch = verdier.slice(i, i + BATCH_STØRRELSE);
    await indekserVerdier(batch);
    const lastet = Math.min(i + BATCH_STØRRELSE, verdier.length);
    console.log(`[indeksering] "${konfig.slicer_tittel}": ${lastet}/${verdier.length}`);
  }
  const indekseringsMs = Date.now() - tIndeksStart;

  // 5. Oppdater konfig
  await prisma.slicerIndeksering.update({
    where: { id: konfigId },
    data:  {
      sist_indeksert:    new Date(),
      sist_antall_rader: verdier.length,
    },
  });

  console.log(`[indeksering] ferdig "${konfig.slicer_tittel}": DAX ${daxResultat.spørringMs}ms + indeks ${indekseringsMs}ms`);

  return {
    konfig_id:       konfigId,
    slicer_tittel:   konfig.slicer_tittel,
    antall_rader:    verdier.length,
    spørrings_ms:    daxResultat.spørringMs,
    indekserings_ms: indekseringsMs,
  };
}

/** Indekserer alle aktive slicere for én rapport. Hver feiler isolert. */
export async function indekserRapport(rapportId: string): Promise<IndekseringResultat[]> {
  const konfiger = await prisma.slicerIndeksering.findMany({
    where: { rapport_id: rapportId, er_aktiv: true },
  });
  console.log(`[indeksering] rapport ${rapportId}: ${konfiger.length} aktive konfig(er)`);

  const resultater: IndekseringResultat[] = [];
  for (const k of konfiger) {
    try {
      resultater.push(await indekserSlicer(k.id));
    } catch (err) {
      const melding = err instanceof Error ? err.message : String(err);
      console.error(`[indeksering] feilet for "${k.slicer_tittel}": ${melding}`);
      resultater.push({
        konfig_id:       k.id,
        slicer_tittel:   k.slicer_tittel,
        antall_rader:    0,
        spørrings_ms:    0,
        indekserings_ms: 0,
        feil:            melding,
      });
    }
  }
  return resultater;
}

/** Returnerer true hvis sliceren aldri har vært indeksert eller er eldre enn terskelen. */
export async function trengerReindeksering(
  konfigId:    string,
  terskelTimer = 24,
): Promise<boolean> {
  const konfig = await prisma.slicerIndeksering.findUnique({
    where:  { id: konfigId },
    select: { sist_indeksert: true },
  });
  if (!konfig) return false;
  if (!konfig.sist_indeksert) return true;
  const alderMs = Date.now() - konfig.sist_indeksert.getTime();
  return alderMs > terskelTimer * 60 * 60 * 1000;
}

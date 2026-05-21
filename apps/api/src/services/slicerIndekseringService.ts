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
  TOPP_MARKOR,
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

/**
 * Indekserer én slicer ut fra lagret konfig. Throw'er ved feil.
 *
 * Uavhengig av utfall oppdateres `sist_kjort` og `sist_feil`-feltene:
 *   - Suksess: sist_indeksert + sist_antall_rader + sist_kjort settes,
 *              sist_feil nullstilles.
 *   - Feil:    sist_kjort settes til forsøkstidspunktet, sist_feil settes
 *              til feilmeldingen (trunkert til 500 tegn). Original feil
 *              re-throw'es til kaller.
 *
 * Denne semantikken brukes av både manuell trigger fra UI og scheduler.
 */
export async function indekserSlicer(konfigId: string): Promise<IndekseringResultat> {
  const startTidspunkt = new Date();

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

  try {
    // 1. DAX
    const daxResultat = await utførDax({
      workspaceId: konfig.workspace_id,
      datasetId:   konfig.dataset_id,
      dax:         konfig.dax_query,
    });

    // 2. Transformer rader → SlicerVerdi[]
    const verdier: SlicerVerdi[] = [];
    // Hierarki: samle DISTINCT topp-nivå-verdier for å indeksere dem som
    // egne rader med markøren TOPP_MARKOR. Lar AI Search-fallback finne
    // kollapsede topp-noder som ikke er rapportert av frontend-state.
    const toppNivaVerdier = new Set<string>();
    for (const rad of daxResultat.rader) {
      const rådVerdi = rad[konfig.verdi_kolonne];
      if (rådVerdi === null || rådVerdi === undefined || rådVerdi === '') continue;
      const verdi = String(rådVerdi);

      if (konfig.slicer_type === 'hierarchy' && konfig.forelder_kolonne) {
        const rådForelder = rad[konfig.forelder_kolonne];
        if (rådForelder === null || rådForelder === undefined || rådForelder === '') continue;
        const forelderVerdi = String(rådForelder);
        verdier.push({
          tenant:         konfig.tenant,
          rapport_id:     konfig.rapport_id,
          slicer_tittel:  konfig.slicer_tittel,
          slicer_type:    'hierarchy',
          verdi,
          forelder_verdi: forelderVerdi,
        });
        toppNivaVerdier.add(forelderVerdi);
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

    // 2b. Indekser topp-nivå-rader (kun for hierarki) — bruker markør så
    // matchEnTopp kan filtrere mot dem uten å forveksles med barn-rader.
    if (konfig.slicer_type === 'hierarchy' && toppNivaVerdier.size > 0) {
      for (const toppVerdi of toppNivaVerdier) {
        verdier.push({
          tenant:         konfig.tenant,
          rapport_id:     konfig.rapport_id,
          slicer_tittel:  konfig.slicer_tittel,
          slicer_type:    'hierarchy',
          verdi:          toppVerdi,
          forelder_verdi: TOPP_MARKOR,
        });
      }
    }

    console.log(`[indeksering] "${konfig.slicer_tittel}": ${verdier.length} rader klare for indeksering` +
      (konfig.slicer_type === 'hierarchy' ? ` (inkl. ${toppNivaVerdier.size} topp-nivå-rader)` : ''));

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

    // 5. Oppdater konfig — suksess
    await prisma.slicerIndeksering.update({
      where: { id: konfigId },
      data:  {
        sist_indeksert:    startTidspunkt,
        sist_kjort:        startTidspunkt,
        sist_antall_rader: verdier.length,
        sist_feil:         null,
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
  } catch (err) {
    // Lagre feilstatus så scheduler/UI kan vise den. Best-effort —
    // hvis selve DB-skrivingen feiler, log og kast originalfeilen videre.
    const melding = err instanceof Error ? err.message : String(err);
    try {
      await prisma.slicerIndeksering.update({
        where: { id: konfigId },
        data: {
          sist_kjort: startTidspunkt,
          sist_feil:  melding.slice(0, 500),
        },
      });
    } catch (lagreFeil) {
      console.error(`[indeksering] kunne ikke lagre feilstatus for ${konfigId}:`, lagreFeil);
    }
    throw err;
  }
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

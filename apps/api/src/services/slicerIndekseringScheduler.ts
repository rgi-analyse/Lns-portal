/**
 * Daglig auto-indeksering av alle aktive slicer-konfigurasjoner.
 *
 * Bruker croner (zero-dep, lightweight) for in-process cron-job.
 * Kjøres kl 06:00 Europe/Oslo (handterer sommertid/vintertid auto).
 *
 * Fail-soft: hvis én konfig feiler, logges det og scheduler fortsetter
 * med resten. indekserSlicer-tjenesten oppdaterer sist_kjort + sist_feil
 * på konfigen så feilet kan vises i admin-UI.
 *
 * Kontroll via env:
 *   SCHEDULER_ENABLED=false   → ikke start scheduler ved oppstart
 *                               (default: true; nyttig for lokal utvikling)
 *   SCHEDULER_TIME=06:00      → eksplisitt cron-tidspunkt (default 06:00)
 */

import { Cron } from 'croner';
import { prisma } from '../lib/prisma';
import { indekserSlicer, type IndekseringResultat } from './slicerIndekseringService';
import { logger } from '../lib/logger';

const TIDSSONE        = 'Europe/Oslo';
const DEFAULT_TID     = '06:00';

let aktivJob:    Cron | null = null;
let sistKjøring: Date | null = null;

interface SchedulerStatus {
  aktiv:          boolean;
  cron_uttrykk:   string | null;
  tidssone:       string;
  neste_kjoring:  string | null;
  sist_kjoring:   string | null;
}

function tidTilCronUttrykk(tid: string): string {
  // "06:00" → "0 6 * * *"
  const m = tid.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`Ugyldig SCHEDULER_TIME: "${tid}". Forventet HH:MM-format.`);
  const time = parseInt(m[1], 10);
  const minutter = parseInt(m[2], 10);
  if (time < 0 || time > 23 || minutter < 0 || minutter > 59) {
    throw new Error(`Ugyldig tid: ${tid}`);
  }
  return `${minutter} ${time} * * *`;
}

/** Den faktiske jobben — itererer alle aktive konfig-er. Eksportert for test. */
export async function kjorAlleAktive(): Promise<{
  total:    number;
  suksess:  number;
  feilet:   number;
  total_ms: number;
  resultater: IndekseringResultat[];
}> {
  const t0 = Date.now();
  sistKjøring = new Date();

  const konfiger = await prisma.slicerIndeksering.findMany({
    where:   { er_aktiv: true },
    orderBy: { slicer_tittel: 'asc' },
  });

  logger.warn(`[scheduler] starter daglig indeksering — ${konfiger.length} aktive konfig(er)`);

  const resultater: IndekseringResultat[] = [];
  let suksess = 0;
  let feilet  = 0;

  for (const k of konfiger) {
    logger.debug(`[scheduler] indekserer ${k.tenant}/${k.rapport_id}/${k.slicer_tittel} (${k.slicer_type})`);
    try {
      const r = await indekserSlicer(k.id);
      resultater.push(r);
      suksess++;
      logger.debug(`[scheduler] ✓ "${k.slicer_tittel}": ${r.antall_rader} rader (DAX ${r.spørrings_ms}ms + indeks ${r.indekserings_ms}ms)`);
    } catch (err) {
      const melding = err instanceof Error ? err.message : String(err);
      feilet++;
      resultater.push({
        konfig_id:       k.id,
        slicer_tittel:   k.slicer_tittel,
        antall_rader:    0,
        spørrings_ms:    0,
        indekserings_ms: 0,
        feil:            melding,
      });
      logger.error(`[scheduler] ✗ "${k.slicer_tittel}": ${melding}`);
    }
  }

  const total_ms = Date.now() - t0;
  logger.warn(
    `[scheduler] ferdig — ${suksess}/${konfiger.length} OK, ${feilet} feilet, ` +
    `total ${total_ms}ms (${(total_ms / 1000).toFixed(1)}s)`,
  );

  return { total: konfiger.length, suksess, feilet, total_ms, resultater };
}

/**
 * Start scheduler. Returnerer true hvis aktivert, false hvis disabled
 * eller feilet. Skal IKKE kaste — server-startup må ikke blokkere.
 */
export function startScheduler(): boolean {
  if (aktivJob) {
    logger.debug('[scheduler] allerede startet — hopper over');
    return true;
  }

  const aktivert = process.env.SCHEDULER_ENABLED !== 'false';
  if (!aktivert) {
    logger.warn('[scheduler] SCHEDULER_ENABLED=false — scheduler ikke startet');
    return false;
  }

  const tid = process.env.SCHEDULER_TIME ?? DEFAULT_TID;
  let cronUttrykk: string;
  try {
    cronUttrykk = tidTilCronUttrykk(tid);
  } catch (err) {
    logger.warn(`[scheduler] kunne ikke parse SCHEDULER_TIME — scheduler ikke startet:`, err instanceof Error ? err.message : err);
    return false;
  }

  try {
    aktivJob = new Cron(cronUttrykk, { timezone: TIDSSONE, name: 'slicer-indeksering' }, async () => {
      try {
        await kjorAlleAktive();
      } catch (err) {
        logger.error('[scheduler] uventet feil i kjorAlleAktive — scheduler fortsetter:', err);
      }
    });
    logger.warn(`[scheduler] Slicer-indeksering aktivert: kjører kl ${tid} ${TIDSSONE} (cron="${cronUttrykk}")`);
    return true;
  } catch (err) {
    logger.warn('[scheduler] kunne ikke starte cron — kjører videre uten:', err instanceof Error ? err.message : err);
    aktivJob = null;
    return false;
  }
}

/** Stoppes typisk kun ved server-shutdown eller i tester. */
export function stoppScheduler(): void {
  if (aktivJob) {
    aktivJob.stop();
    aktivJob = null;
    logger.warn('[scheduler] stoppet');
  }
}

/** Returnerer status til admin-endpoint og diagnostikk. */
export function hentSchedulerStatus(): SchedulerStatus {
  const aktiv = aktivJob !== null;
  const neste = aktivJob?.nextRun() ?? null;
  return {
    aktiv,
    cron_uttrykk:  aktivJob?.getPattern() ?? null,
    tidssone:      TIDSSONE,
    neste_kjoring: neste ? neste.toISOString() : null,
    sist_kjoring:  sistKjøring ? sistKjøring.toISOString() : null,
  };
}

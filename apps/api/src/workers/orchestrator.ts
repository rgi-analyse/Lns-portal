import { prisma } from '../lib/prisma';

// Statusverdier som matcher CHECK_ai_analyse_bestilling_status i DB
const STATUS = {
  BESTILT:    'BESTILT',
  KJORER:     'KJORER',  // NB: uten Ø — DB-constraint tillater ikke Ø
  FERDIG:     'FERDIG',
  FEILET:     'FEILET',
  KANSELLERT: 'KANSELLERT',
} as const;

/**
 * Hovedflyt for én analyse-bestilling.
 * Henter eldste BESTILT på tvers av tenants, markerer som KJORER med
 * optimistic lock, og logger plukkingen. Faktisk prosessering kommer i Steg B3.
 */
export async function kjørOrchestrator(): Promise<void> {
  const bestilling = await prisma.analyseBestilling.findFirst({
    where:   { status: STATUS.BESTILT },
    orderBy: { bestiltDato: 'asc' },
    select: {
      id:            true,
      analyseTypeId: true,
      brukerId:      true,
      tenantSlug:    true,
      bestiltDato:   true,
      forsokAntall:  true,
    },
  });

  if (!bestilling) {
    console.log('[Orchestrator] Ingen ventende bestillinger');
    return;
  }

  console.log(
    `[Orchestrator] Plukket opp bestilling ${bestilling.id} ` +
    `(type: ${bestilling.analyseTypeId}, tenant: ${bestilling.tenantSlug})`,
  );

  // Optimistic lock: oppdater kun hvis status fortsatt er BESTILT —
  // hindrer at to instanser plukker samme rad samtidig.
  const oppdatert = await prisma.analyseBestilling.updateMany({
    where: { id: bestilling.id, status: STATUS.BESTILT },
    data: {
      status:       STATUS.KJORER,
      startetDato:  new Date(),
      forsokAntall: { increment: 1 },
    },
  });

  if (oppdatert.count === 0) {
    console.log(`[Orchestrator] ${bestilling.id} ble plukket av annen instans, hopper over`);
    return;
  }

  const nyttForsøk = bestilling.forsokAntall + 1;
  console.log(`[Orchestrator] Markerte ${bestilling.id} som ${STATUS.KJORER} (forsøk ${nyttForsøk})`);

  // TODO Steg B3: faktisk prosessering + marker som FERDIG/FEILET.
  // Inntil videre henger bestillingen i KJORER.
}

import { prisma } from '../lib/prisma';

/**
 * Hovedflyt for én analyse-bestilling.
 * Henter eldste BESTILT på tvers av tenants, markerer som KJØRER med
 * optimistic lock, og logger plukkingen. Faktisk prosessering kommer i Steg B3.
 */
export async function kjørOrchestrator(): Promise<void> {
  const bestilling = await prisma.analyseBestilling.findFirst({
    where:   { status: 'BESTILT' },
    orderBy: { bestiltDato: 'asc' },
    select: {
      id:            true,
      analyseTypeId: true,
      brukerId:      true,
      tenantSlug:    true,
      bestiltDato:   true,
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
    where: { id: bestilling.id, status: 'BESTILT' },
    data:  { status: 'KJØRER', startetDato: new Date() },
  });

  if (oppdatert.count === 0) {
    console.log(`[Orchestrator] ${bestilling.id} ble plukket av annen instans, hopper over`);
    return;
  }

  console.log(`[Orchestrator] Markerte ${bestilling.id} som KJØRER`);

  // TODO Steg B3: faktisk prosessering + marker som FERDIG/FEILET.
  // Inntil videre henger bestillingen i KJØRER.
}

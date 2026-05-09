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

  // SIMULER ARBEID — placeholder, erstattes med ekte logikk i Steg C-F
  console.log(`[Orchestrator] Simulerer prosessering for ${bestilling.id}...`);
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Marker som FERDIG med placeholder-resultat. Trygt å bruke update (ikke
  // updateMany): vi har allerede vunnet optimistic lock ovenfor.
  await prisma.analyseBestilling.update({
    where: { id: bestilling.id },
    data: {
      status:       STATUS.FERDIG,
      ferdigDato:   new Date(),
      tittel:       `Test-rapport for ${bestilling.analyseTypeId}`,
      sammendrag:   'Placeholder-sammendrag — ekte AI-generert innhold kommer i Steg D.',
      dokumentUrl:  'https://placeholder.example.com/test.docx',
      dokumentNavn: 'test-rapport.docx',
      tokenForbruk: 0,
      modellBrukt:  'placeholder',
    },
  });

  console.log(`[Orchestrator] Markerte ${bestilling.id} som ${STATUS.FERDIG} (placeholder)`);
}

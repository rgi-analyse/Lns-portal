import { app, InvocationContext, Timer } from '@azure/functions';

export async function pollBestillinger(
  myTimer: Timer,
  context: InvocationContext
): Promise<void> {
  const tidspunkt = new Date().toISOString();
  context.log(`[Worker] Polling kjører: ${tidspunkt}`);

  if (myTimer.isPastDue) {
    context.log('[Worker] Timer is past due!');
  }

  // TODO: Implementer polling-logikk i Steg B
  context.log('[Worker] Ferdig med iterasjon');
}

app.timer('pollBestillinger', {
  schedule: '0 */1 * * * *', // Hvert minutt
  handler: pollBestillinger,
});

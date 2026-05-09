import { Cron } from 'croner';
import { kjørOrchestrator } from './orchestrator';

let pågåendeKjøring = false;

export function startAnalyseWorker(): void {
  console.log('[AnalyseWorker] Starter polling-scheduler');

  new Cron('* * * * *', async () => {
    if (pågåendeKjøring) {
      console.log('[AnalyseWorker] Forrige kjøring pågår, hopper over denne');
      return;
    }

    pågåendeKjøring = true;
    const startTid = new Date();

    try {
      console.log(`[AnalyseWorker] Polling kjører: ${startTid.toISOString()}`);
      await kjørOrchestrator();
    } catch (err) {
      console.error('[AnalyseWorker] Feil under polling:', err);
    } finally {
      pågåendeKjøring = false;
      const sluttTid = new Date();
      const varighet = sluttTid.getTime() - startTid.getTime();
      console.log(`[AnalyseWorker] Iterasjon ferdig (${varighet}ms)`);
    }
  });
}

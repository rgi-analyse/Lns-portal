import { Cron } from 'croner';
import { logger } from '../lib/logger';
import { kjørOrchestrator } from './orchestrator';

let pågåendeKjøring = false;

export function startAnalyseWorker(): void {
  logger.warn('[AnalyseWorker] Starter polling-scheduler');

  new Cron('* * * * *', async () => {
    if (pågåendeKjøring) {
      logger.warn('[AnalyseWorker] Forrige kjøring pågår, hopper over denne');
      return;
    }

    pågåendeKjøring = true;
    const startTid = new Date();

    try {
      logger.debug(`[AnalyseWorker] Polling kjører: ${startTid.toISOString()}`);
      await kjørOrchestrator();
    } catch (err) {
      logger.error('[AnalyseWorker] Feil under polling:', err);
    } finally {
      pågåendeKjøring = false;
      const sluttTid = new Date();
      const varighet = sluttTid.getTime() - startTid.getTime();
      logger.debug(`[AnalyseWorker] Iterasjon ferdig (${varighet}ms)`);
    }
  });
}

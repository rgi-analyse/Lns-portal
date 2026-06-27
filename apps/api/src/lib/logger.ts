/**
 * Delt logger-modul. Dupliseres IDENTISK i apps/portal/lib/logger.ts —
 * hold de to filene i sync ved endringer.
 *
 * Dev  (NODE_ENV !== 'production'): alle nivåer logges.
 * Prod (NODE_ENV === 'production'): kun warn + error.
 *
 * warn/error sender argumentene VERBATIM videre til console.warn/console.error —
 * ingen lagt-til prefix/timestamp/format. Dermed er Azure App Service-loggens
 * warn/error-linjer identiske med dagens console.* (backward-compat for
 * eksisterende parsers/alerts). Kun debug/info undertrykkes i prod.
 *
 * Fungerer i både Node (tsx/tsc) og Next (browser/SSR): process.env.NODE_ENV
 * leses i runtime på server og inlines ved build i nettleser-bundlen.
 */
type Nivaa = 'debug' | 'info' | 'warn' | 'error';

const erProd = process.env.NODE_ENV === 'production';

const skalLogge = (nivaa: Nivaa): boolean =>
  erProd ? nivaa === 'warn' || nivaa === 'error' : true;

export const logger = {
  debug: (...args: unknown[]) => { if (skalLogge('debug')) console.log(...args); },
  info:  (...args: unknown[]) => { if (skalLogge('info'))  console.info(...args); },
  warn:  (...args: unknown[]) => { if (skalLogge('warn'))  console.warn(...args); },
  error: (...args: unknown[]) => { if (skalLogge('error')) console.error(...args); },
};

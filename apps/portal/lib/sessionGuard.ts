'use client';

import {
  type PublicClientApplication,
  InteractionRequiredAuthError,
} from '@azure/msal-browser';
import { getLocalSession } from './localAuth';
import { logger } from './logger';

const INAKTIVITETS_MS = 8 * 60 * 60 * 1000; // 8 timer
const STORAGE_KEY = 'lns-siste-aktivitet';

/** Callback som vises i stedet for redirect når en kontrollrom-rute mister sesjonen. */
export type KontrollromUtloptHandler = (loginUrl: string, tidspunkt: Date) => void;

export class SessionGuard {
  private msalInstance: PublicClientApplication;
  private loginScopes: string[];
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private onKontrollromUtlopt?: KontrollromUtloptHandler;
  private overlayVist = false;

  constructor(
    msalInstance: PublicClientApplication,
    loginScopes: string[],
    onKontrollromUtlopt?: KontrollromUtloptHandler,
  ) {
    this.msalInstance = msalInstance;
    this.loginScopes = loginScopes;
    this.onKontrollromUtlopt = onKontrollromUtlopt;
  }

  start() {
    if (this.erLoginSide()) {
      logger.debug('[SessionGuard] På login-side — guard deaktivert');
      return;
    }
    this.registrerAktivitet();
    this.startInaktivitetsTimer();
    this.lyttPaaBrukerAktivitet();
    this.lyttPaaTabFokus();
  }

  private erLoginSide(): boolean {
    if (typeof window === 'undefined') return true;
    const path = window.location.pathname;
    return path === '/' || path === '/login' || path.startsWith('/auth');
  }

  /**
   * Kontrollrom-ruter (sensor-dashbord) kjører på delte, ubemannede 24/7-skjermer.
   * Der skal utløpt sesjon vise et synlig overlay i stedet for å redirecte — en
   * redirect-løkke ser ut som en frossen skjerm for en operatør på avstand.
   */
  private erKontrollrom(): boolean {
    if (typeof window === 'undefined') return false;
    return window.location.pathname.startsWith('/dashboard/sensorer/');
  }

  private registrerAktivitet = () => {
    localStorage.setItem(STORAGE_KEY, Date.now().toString());
  };

  private startInaktivitetsTimer = () => {
    if (this.timerId) clearTimeout(this.timerId);
    this.timerId = setTimeout(() => {
      logger.warn('[SessionGuard] Inaktivitets-timeout — logger ut');
      this.triggerReLogin();
    }, INAKTIVITETS_MS);
  };

  private lyttPaaBrukerAktivitet = () => {
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'] as const;
    let sisteReset = 0;
    const throttledHandler = () => {
      if (Date.now() - sisteReset > 30_000) {
        this.registrerAktivitet();
        this.startInaktivitetsTimer();
        sisteReset = Date.now();
      }
    };
    events.forEach(e => window.addEventListener(e, throttledHandler, { passive: true }));
  };

  private lyttPaaTabFokus = () => {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void this.sjekkSession();
      }
    });
  };

  private sjekkSession = async () => {
    // Sjekk inaktivitetstid fra localStorage
    const siste = localStorage.getItem(STORAGE_KEY);
    if (siste) {
      const elapsed = Date.now() - parseInt(siste, 10);
      if (elapsed > INAKTIVITETS_MS) {
        logger.warn('[SessionGuard] Session utløpt basert på inaktivitet');
        this.triggerReLogin();
        return;
      }
    }

    // MSAL v3 krever initialize() før noen MSAL API-kall. MsalProvider gjør dette
    // asynkront ved mount, så sjekkVedOppstart() kan race det (uninitialized-feil
    // i konsollen). initialize() er idempotent — trygt å awaite her for å lukke racen.
    await this.msalInstance.initialize();

    // Verifiser at MSAL-token fortsatt er gyldig
    const account =
      this.msalInstance.getActiveAccount() ??
      this.msalInstance.getAllAccounts()[0];

    if (!account) {
      // Lokal bruker (sessionStorage) har ingen MSAL-account — SessionGuards
      // MSAL-token-sjekk gjelder ikke dem. Ikke trigger re-login (ellers logges
      // alle lokale brukere ut ved hver sidelast etter init-race-fiksen).
      if (getLocalSession()) return;
      logger.warn('[SessionGuard] Ingen MSAL-account funnet');
      this.triggerReLogin();
      return;
    }

    try {
      await this.msalInstance.acquireTokenSilent({
        scopes: this.loginScopes,
        account,
      });
      logger.debug('[SessionGuard] ✅ Token OK');
      this.registrerAktivitet();
    } catch (err) {
      if (err instanceof InteractionRequiredAuthError) {
        logger.warn('[SessionGuard] Silent token-refresh feilet → re-login');
        this.triggerReLogin();
      } else {
        logger.warn('[SessionGuard] Uventet feil ved token-sjekk:', err);
      }
    }
  };

  private triggerReLogin = () => {
    if (this.erLoginSide()) {
      // Allerede på login-side — ikke redirect igjen
      logger.debug('[SessionGuard] Er allerede på login-side, ingen redirect');
      return;
    }

    localStorage.removeItem(STORAGE_KEY);

    // Kun pathname (ikke search) som returnTo — unngår eksponentiell URL-vekst
    const currentPath = window.location.pathname;
    const safeReturnTo = currentPath.startsWith('/dashboard') ? currentPath : '/dashboard';
    const loginUrl = `/?expired=true&returnTo=${encodeURIComponent(safeReturnTo)}`;

    // Kontrollrom: vis blokkerende overlay i stedet for redirect. Gjelder begge
    // utkastveier (inaktivitet + silent-refresh-feil) og oppstart med allerede
    // utløpt sesjon — alt går via triggerReLogin. Overlay-knappen utfører den
    // samme redirecten (med bevart returnTo) når operatøren selv velger det.
    if (this.erKontrollrom() && this.onKontrollromUtlopt) {
      if (this.overlayVist) return; // allerede vist — ikke oppdater tidspunkt/re-render på nytt
      this.overlayVist = true;
      logger.warn('[SessionGuard] Kontrollrom-sesjon utløpt — viser overlay i stedet for redirect');
      this.onKontrollromUtlopt(loginUrl, new Date());
      return;
    }

    logger.warn('[SessionGuard] Timeout — sender til login:', loginUrl);
    window.location.href = loginUrl;
  };

  /** Kalles ved første sidelasting — fanger "første gang på dagen"-tilstanden */
  async sjekkVedOppstart() {
    if (this.erLoginSide()) return;
    await this.sjekkSession();
  }
}

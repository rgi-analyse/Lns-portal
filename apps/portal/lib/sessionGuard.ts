'use client';

import {
  type PublicClientApplication,
  InteractionRequiredAuthError,
} from '@azure/msal-browser';

const INAKTIVITETS_MS = 8 * 60 * 60 * 1000; // 8 timer
const STORAGE_KEY = 'lns-siste-aktivitet';

export class SessionGuard {
  private msalInstance: PublicClientApplication;
  private loginScopes: string[];
  private timerId: ReturnType<typeof setTimeout> | null = null;

  constructor(msalInstance: PublicClientApplication, loginScopes: string[]) {
    this.msalInstance = msalInstance;
    this.loginScopes = loginScopes;
  }

  start() {
    this.registrerAktivitet();
    this.startInaktivitetsTimer();
    this.lyttPaaBrukerAktivitet();
    this.lyttPaaTabFokus();
  }

  private registrerAktivitet = () => {
    localStorage.setItem(STORAGE_KEY, Date.now().toString());
  };

  private startInaktivitetsTimer = () => {
    if (this.timerId) clearTimeout(this.timerId);
    this.timerId = setTimeout(() => {
      console.log('[SessionGuard] Inaktivitets-timeout — logger ut');
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
        console.log('[SessionGuard] Session utløpt basert på inaktivitet');
        this.triggerReLogin();
        return;
      }
    }

    // Verifiser at MSAL-token fortsatt er gyldig
    const account =
      this.msalInstance.getActiveAccount() ??
      this.msalInstance.getAllAccounts()[0];

    if (!account) {
      console.log('[SessionGuard] Ingen MSAL-account funnet');
      this.triggerReLogin();
      return;
    }

    try {
      await this.msalInstance.acquireTokenSilent({
        scopes: this.loginScopes,
        account,
      });
      console.log('[SessionGuard] ✅ Token OK');
      this.registrerAktivitet();
    } catch (err) {
      if (err instanceof InteractionRequiredAuthError) {
        console.log('[SessionGuard] Silent token-refresh feilet → re-login');
        this.triggerReLogin();
      } else {
        console.warn('[SessionGuard] Uventet feil ved token-sjekk:', err);
      }
    }
  };

  private triggerReLogin = () => {
    localStorage.removeItem(STORAGE_KEY);

    // Rut til felles login-side som håndterer både Entra og lokal auth
    const currentPath = window.location.pathname + window.location.search;
    const loginUrl = `/?expired=true&returnTo=${encodeURIComponent(currentPath)}`;

    console.log('[SessionGuard] Timeout — sender til login:', loginUrl);
    window.location.href = loginUrl;
  };

  /** Kalles ved første sidelasting — fanger "første gang på dagen"-tilstanden */
  async sjekkVedOppstart() {
    await this.sjekkSession();
  }
}

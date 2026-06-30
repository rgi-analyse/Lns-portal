'use client';

import { useEffect, useRef } from 'react';
import { MsalProvider, useIsAuthenticated, useMsal } from '@azure/msal-react';
import { PublicClientApplication } from '@azure/msal-browser';
import { msalConfig, loginRequest } from '@/lib/authConfig';
import { SessionGuard } from '@/lib/sessionGuard';
import { logger } from '@/lib/logger';

const msalInstance = new PublicClientApplication(msalConfig);

function InnloggingsRegistrerer() {
  const isAuthenticated = useIsAuthenticated();
  const { accounts } = useMsal();
  const registrert = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !accounts[0] || registrert.current) return;
    registrert.current = true;
    const entraId = accounts[0].localAccountId;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? '';
    fetch(`${apiUrl}/api/auth/registrer-innlogging`, {
      method: 'POST',
      headers: {
        'x-tenant-id': 'lns',
        'x-entra-object-id': entraId,
      },
    }).catch(err => logger.warn('[Auth] kunne ikke registrere innlogging:', err));
  }, [isAuthenticated, accounts]);

  return null;
}

function SessionGuardSetup() {
  const { instance } = useMsal();

  useEffect(() => {
    const guard = new SessionGuard(instance as PublicClientApplication, loginRequest.scopes as string[]);

    // Sjekk ved oppstart — fanger "første gang på dagen"-tilstanden
    guard.sjekkVedOppstart().catch(err => logger.warn('[Auth] sesjonssjekk ved oppstart feilet:', err));

    // Start kontinuerlig overvåkning (inaktivitet + tab-fokus)
    guard.start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <MsalProvider instance={msalInstance}>
      <InnloggingsRegistrerer />
      <SessionGuardSetup />
      {children}
    </MsalProvider>
  );
}

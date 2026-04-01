'use client';

import { useEffect, useRef } from 'react';
import { MsalProvider, useIsAuthenticated, useMsal } from '@azure/msal-react';
import { PublicClientApplication } from '@azure/msal-browser';
import { msalConfig } from '@/lib/authConfig';

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
    }).catch(() => {});
  }, [isAuthenticated, accounts]);

  return null;
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <MsalProvider instance={msalInstance}>
      <InnloggingsRegistrerer />
      {children}
    </MsalProvider>
  );
}

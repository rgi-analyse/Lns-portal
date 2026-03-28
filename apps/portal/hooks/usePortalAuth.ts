'use client';

import { useState, useMemo, useCallback } from 'react';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { getLocalSession, clearLocalSession, type LocalSession } from '@/lib/localAuth';

export interface PortalAuth {
  isAuthenticated: boolean;
  entraObjectId:  string | undefined;
  displayName:    string;
  email:          string | undefined;
  /** For MSAL users, rolle is fetched separately from /api/me */
  rolle:          string | undefined;
  isLocal:        boolean;
  /** Convenience: { 'X-Entra-Object-Id': entraObjectId } or {} */
  authHeaders:    Record<string, string>;
  /** Groups from MSAL token (Entra users) or [] (local users) */
  grupper:        string[];
  logout:         () => void;
}

export function usePortalAuth(): PortalAuth {
  const msalAuthenticated      = useIsAuthenticated();
  const { instance, accounts } = useMsal();
  const msalAccount            = accounts[0];

  // Les session synkront på klient (unngår ett-render-delay som kan føre til feil omdirigering)
  const [localSession] = useState<LocalSession | null>(
    () => (typeof window !== 'undefined' ? getLocalSession() : null),
  );

  // ── Stabile primitive verdier ────────────────────────────────────────────
  const msalEntraObjectId = msalAccount?.localAccountId;
  const localEntraObjectId = localSession?.entraObjectId;

  // Memoiser authHeaders — ny referanse kun når OID faktisk endres
  const msalAuthHeaders = useMemo<Record<string, string>>(
    (): Record<string, string> => (msalEntraObjectId ? { 'X-Entra-Object-Id': msalEntraObjectId } : {}),
    [msalEntraObjectId],
  );
  const localAuthHeaders = useMemo<Record<string, string>>(
    (): Record<string, string> => (localEntraObjectId ? { 'X-Entra-Object-Id': localEntraObjectId } : {}),
    [localEntraObjectId],
  );
  const emptyAuthHeaders = useMemo<Record<string, string>>((): Record<string, string> => ({}), []);

  // Memoiser grupper — ny referanse kun når gruppe-listen faktisk endres
  const msalGrupper = useMemo(() => {
    const claims = msalAccount?.idTokenClaims as { groups?: string[] } | undefined;
    return claims?.groups ?? [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msalAccount?.localAccountId]);           // OID endres = ny token = nye grupper
  const emptyGrupper = useMemo(() => [], []);  // aldri ny referanse

  // Memoiser logout-funksjoner
  const msalLogout = useCallback(
    () => instance.logoutRedirect({ postLogoutRedirectUri: '/' }),
    [instance],
  );
  const localLogout = useCallback(() => {
    clearLocalSession();
    window.location.href = '/';
  }, []);
  const noopLogout = useCallback(() => { window.location.href = '/'; }, []);

  // ── Entra (MSAL) bruker ──────────────────────────────────────────────────
  if (msalAuthenticated && msalAccount) {
    return {
      isAuthenticated: true,
      entraObjectId:   msalEntraObjectId,
      displayName:     msalAccount.name ?? msalAccount.username ?? 'Bruker',
      email:           msalAccount.username,
      rolle:           undefined,
      isLocal:         false,
      authHeaders:     msalAuthHeaders,
      grupper:         msalGrupper,
      logout:          msalLogout,
    };
  }

  // ── Lokal bruker (sessionStorage) ────────────────────────────────────────
  if (localSession) {
    return {
      isAuthenticated: true,
      entraObjectId:   localEntraObjectId,
      displayName:     localSession.displayName ?? 'Bruker',
      email:           localSession.email ?? undefined,
      rolle:           localSession.rolle,
      isLocal:         true,
      authHeaders:     localAuthHeaders,
      grupper:         emptyGrupper,
      logout:          localLogout,
    };
  }

  // ── Ikke innlogget ────────────────────────────────────────────────────────
  return {
    isAuthenticated: false,
    entraObjectId:   undefined,
    displayName:     'Bruker',
    email:           undefined,
    rolle:           undefined,
    isLocal:         false,
    authHeaders:     emptyAuthHeaders,
    grupper:         emptyGrupper,
    logout:          noopLogout,
  };
}

import { Configuration, PopupRequest } from '@azure/msal-browser';

// ── Azure-konfigurasjon for gruppe-claims ────────────────────────────────────
// For at idTokenClaims.groups (gruppe-ID-er) skal inkluderes i token må følgende
// konfigureres i Azure Portal:
//
//   App registrations → synapse-portal → Token configuration
//   → Add groups claim → Security groups → Lagre
//
// Uten dette vil account.idTokenClaims?.groups være undefined, og
// tilgangsfiltreringen i Sidebar og RapportPage vil falle tilbake til
// kun bruker-ID-sjekk (entraId = brukerId).
// ────────────────────────────────────────────────────────────────────────────

const redirectUri =
  typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

export const msalConfig: Configuration = {
  auth: {
    clientId: process.env.NEXT_PUBLIC_AZURE_CLIENT_ID ?? '',
    authority: `https://login.microsoftonline.com/${process.env.NEXT_PUBLIC_AZURE_TENANT_ID ?? ''}`,
    redirectUri,
  },
  cache: {
    cacheLocation: 'sessionStorage',
    storeAuthStateInCookie: false,
  },
};

export const loginRequest: PopupRequest = {
  scopes: [
    'openid',
    'profile',
    'User.Read',
    'https://analysis.windows.net/powerbi/api/Report.Read.All',
  ],
};

export const powerBiScopes = [
  'https://analysis.windows.net/powerbi/api/Report.Read.All',
];

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

interface GraphTokenResponse {
  access_token: string;
}

export interface GraphGroup {
  id: string;
  displayName: string;
  description: string | null;
  mail: string | null;
}

export interface GraphUser {
  id: string;
  displayName: string;
  mail: string | null;
  userPrincipalName: string;
}

export interface GraphMember {
  id: string;
  displayName: string;
  mail: string | null;
}

interface GraphListResponse<T> {
  value: T[];
}

export async function getGraphToken(): Promise<string> {
  const tenantId     = process.env.PBI_TENANT_ID;
  const clientId     = process.env.PBI_CLIENT_ID;
  const clientSecret = process.env.PBI_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Mangler Azure AD-konfigurasjon på serveren.');
  }

  const params = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     clientId,
    client_secret: clientSecret,
    scope:         'https://graph.microsoft.com/.default',
  });

  const response = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Azure AD (Graph) feilet med HTTP ${response.status}: ${body}`);
  }

  const data = await response.json() as GraphTokenResponse;
  return data.access_token;
}

export async function searchGroups(query: string): Promise<GraphGroup[]> {
  const token = await getGraphToken();

  const params = new URLSearchParams();
  params.set('$search',  `"displayName:${query}"`);
  params.set('$select',  'id,displayName,description,mail');
  params.set('$top',     '10');

  const response = await fetch(`${GRAPH_BASE}/groups?${params.toString()}`, {
    headers: {
      Authorization:    `Bearer ${token}`,
      ConsistencyLevel: 'eventual',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Graph /groups feilet med HTTP ${response.status}: ${body}`);
  }

  const data = await response.json() as GraphListResponse<GraphGroup>;
  return Array.isArray(data.value) ? data.value : [];
}

export async function searchUsers(query: string): Promise<GraphUser[]> {
  const token = await getGraphToken();

  const params = new URLSearchParams();
  params.set('$search',  `"displayName:${query}" OR "mail:${query}"`);
  params.set('$select',  'id,displayName,mail,userPrincipalName');
  params.set('$top',     '10');

  const response = await fetch(`${GRAPH_BASE}/users?${params.toString()}`, {
    headers: {
      Authorization:    `Bearer ${token}`,
      ConsistencyLevel: 'eventual',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Graph /users feilet med HTTP ${response.status}: ${body}`);
  }

  const data = await response.json() as GraphListResponse<GraphUser>;
  return Array.isArray(data.value) ? data.value : [];
}

export async function getGroupMembers(groupId: string): Promise<GraphMember[]> {
  const token = await getGraphToken();

  const params = new URLSearchParams();
  params.set('$select', 'id,displayName,mail');

  const response = await fetch(
    `${GRAPH_BASE}/groups/${groupId}/members?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Graph /groups/${groupId}/members feilet med HTTP ${response.status}: ${body}`);
  }

  const data = await response.json() as GraphListResponse<GraphMember>;
  return data.value;
}

// ── Gruppemedlemskaps-verifisering (H1) ──────────────────────────────────────
// Verifiserer klient-styrte ?grupper mot brukerens FAKTISKE medlemskap i Entra,
// slik at en bruker ikke kan claime vilkårlige gruppe-ID-er for å få tilgang.

interface GruppeCache { grupper: Set<string>; hentet: number; }
const gruppeCache = new Map<string, GruppeCache>();
const FRISK_MS = 15 * 60 * 1000;        // < 15 min: returneres direkte fra cache
const STALE_MS = 24 * 60 * 60 * 1000;   // < 24 t:   returneres ved Graph-feil (stale-fallback)

// Henter alle (transitive) grupper brukeren er medlem av — fanger nestede grupper,
// slik MSAL-token-claims kan inneholde. Følger paging.
async function hentTransitiveGrupper(oid: string): Promise<string[]> {
  const token = await getGraphToken();
  const ids: string[] = [];
  let url: string | null =
    `${GRAPH_BASE}/users/${oid}/transitiveMemberOf/microsoft.graph.group?$select=id&$top=999`;
  while (url) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Graph transitiveMemberOf feilet med HTTP ${response.status}: ${body}`);
    }
    const data = await response.json() as GraphListResponse<{ id: string }> & { '@odata.nextLink'?: string };
    for (const g of data.value ?? []) if (g.id) ids.push(g.id);
    url = data['@odata.nextLink'] ?? null;
  }
  return ids;
}

/**
 * Brukerens faktiske gruppe-ID-er (lowercased Set), cachet per oid.
 * Fresh (< 15 min) → direkte fra cache (ingen Graph-kall, ingen ytelsestap).
 * Ved Graph-feil: stale-fallback (< 24 t) → returner forrige verdi; ellers
 * fail-closed → tom mengde (bruker beholder entraId-direkte tilgang, men ingen
 * gruppe-baserte til Graph er tilbake).
 */
export async function hentBrukerGrupper(oid: string): Promise<Set<string>> {
  const cached = gruppeCache.get(oid);
  if (cached && Date.now() - cached.hentet < FRISK_MS) return cached.grupper;
  try {
    const ids = await hentTransitiveGrupper(oid);
    const set = new Set(ids.map((g) => g.toLowerCase()));
    gruppeCache.set(oid, { grupper: set, hentet: Date.now() });
    return set;
  } catch (err) {
    if (cached && Date.now() - cached.hentet < STALE_MS) {
      console.warn(`[graph] stale gruppe-cache for oid=${oid} (Graph-feil, bruker forrige verdi)`);
      return cached.grupper;
    }
    console.error(`[graph] fail-closed gruppe-oppslag for oid=${oid}:`, err instanceof Error ? err.message : err);
    return new Set();
  }
}

/**
 * Returnerer kun de forespurte gruppene brukeren faktisk er medlem av.
 * Lokal (ikke-Entra) bruker eller tom forespørsel → ingen Graph-kall, tom liste.
 * Avviste (ikke-medlems) gruppe-forsøk logges (oid + gruppe-id).
 */
export async function verifiserGrupper(
  oid: string,
  forespurt: string[],
  erEntraBruker: boolean,
): Promise<string[]> {
  if (!erEntraBruker || forespurt.length === 0) return [];
  const faktiske = await hentBrukerGrupper(oid);
  const ok     = forespurt.filter((g) => faktiske.has(g.toLowerCase()));
  const avvist = forespurt.filter((g) => !faktiske.has(g.toLowerCase()));
  if (avvist.length > 0) {
    console.warn(`[graph] avviste gruppe-forsøk oid=${oid} grupper=[${avvist.join(',')}]`);
  }
  return ok;   // original casing — matcher Tilgang.entraId (CI-collation)
}
